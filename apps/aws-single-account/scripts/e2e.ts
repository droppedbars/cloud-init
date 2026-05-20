/* global setTimeout */
import * as path from 'path';
import * as child_process from 'child_process';
import * as readline from 'readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (query: string): Promise<string> =>
  new Promise((resolve) => rl.question(query, resolve));

const rootDir = path.join(__dirname, '..');
const pulumiPassphrase = process.env.PULUMI_CONFIG_PASSPHRASE || 'e2e-test-passphrase';

async function main() {
  console.log('=== Starting End-to-End Test for AWS Single Account Baseline ===');

  try {
    // 2. Init & deploy stack
    console.log("\n>>> Initializing 'e2e-test' stack...");
    child_process.execSync(`aws configure set region ${process.env.AWS_REGION || 'us-east-1'}`);
    child_process.execSync('pulumi stack select e2e-test --create', {
      env: {
        ...process.env,
        BASELINE_CONFIG_PATH: 'scripts/e2e-config.json',
        PULUMI_CONFIG_PASSPHRASE: pulumiPassphrase,
      },
    });

    child_process.execSync(`pulumi config set aws:region ${process.env.AWS_REGION || 'us-east-1'}`);
    console.log('\n>>> Deploying infrastructure (this may take a few minutes)...');
    exec('pulumi up -y');

    // 3. User verification phase (MFA)
    console.log('\n=== Phase 1: MFA & IAM Verification ===');
    const initialPasswordsStr = child_process.execSync(
      'pulumi stack output --show-secrets initialPasswords --json',
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          BASELINE_CONFIG_PATH: 'scripts/e2e-config.json',
          PULUMI_CONFIG_PASSPHRASE: pulumiPassphrase,
        },
      },
    );
    const passwords = JSON.parse(initialPasswordsStr);
    console.log('Created test user: e2e-tester');
    console.log('Password:', passwords['e2e-tester']);

    await question(
      "\nPlease log in to the AWS Console as 'e2e-tester' using the above password.\nAttempt to assume the role 'E2E_TEST_ROLE' WITHOUT setting up MFA. It should fail.\nOnce you have verified this, type 'ok' to continue: ",
    );

    // 4. Kill Switch Auto-test phase
    console.log('\n=== Phase 2: Kill Switch Automated Verification ===');
    console.log('Launching a t3.nano EC2 instance for testing...');

    // Find latest Amazon Linux 2023 AMI
    const amiResult = child_process
      .execSync(
        `aws ec2 describe-images --owners amazon --filters "Name=name,Values=al2023-ami-2023.*-x86_64" --query "sort_by(Images, &CreationDate)[-1].ImageId" --output text`,
        { encoding: 'utf-8' },
      )
      .trim();

    // Launch instance
    const runResult = child_process
      .execSync(
        `aws ec2 run-instances --image-id ${amiResult} --instance-type t3.nano --query "Instances[0].InstanceId" --output text`,
        { encoding: 'utf-8' },
      )
      .trim();
    console.log(`Launched Instance ID: ${runResult}`);

    console.log('Waiting for instance to be running...');
    child_process.execSync(`aws ec2 wait instance-running --instance-ids ${runResult}`);
    console.log('Instance is running!');

    console.log('Finding Kill Switch SNS Topic...');
    const topicsResult = child_process.execSync(
      'aws sns list-topics --query "Topics[*].TopicArn" --output json',
      { encoding: 'utf-8' },
    );
    const topics = JSON.parse(topicsResult);
    const killSwitchTopic = topics.find((arn: string) => arn.includes('kill-switch-topic'));
    if (!killSwitchTopic) throw new Error('Could not find kill-switch-topic in AWS');

    console.log(`Publishing simulation event to ${killSwitchTopic}...`);
    child_process.execSync(
      `aws sns publish --topic-arn "${killSwitchTopic}" --message "E2E Test Simulation"`,
    );

    console.log('Waiting for Lambda to execute and stop the instance...');
    let stopped = false;
    for (let i = 0; i < 20; i++) {
      const state = child_process
        .execSync(
          `aws ec2 describe-instances --instance-ids ${runResult} --query "Reservations[0].Instances[0].State.Name" --output text`,
          { encoding: 'utf-8' },
        )
        .trim();
      if (state === 'stopping' || state === 'stopped') {
        stopped = true;
        break;
      }
      console.log(`Current state: ${state}. Waiting 5 seconds...`);
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (stopped) {
      console.log('✅ Kill Switch Successfully triggered and stopped the instance!');
    } else {
      console.error('❌ Instance was not stopped within 100 seconds.');
    }

    console.log(`Terminating test instance ${runResult}...`);
    child_process.execSync(`aws ec2 terminate-instances --instance-ids ${runResult}`);

    console.log('\n=== Testing Complete! ===');
  } finally {
    console.log('\n>>> Destroying infrastructure (this may take a few minutes)...');
    exec('pulumi destroy -y');
    console.log('>>> Removing stack...');
    exec('pulumi stack rm e2e-test -y');

    rl.close();
  }
}

function exec(cmd: string) {
  child_process.execSync(cmd, {
    stdio: 'inherit',
    cwd: rootDir,
    env: {
      ...process.env,
      BASELINE_CONFIG_PATH: 'scripts/e2e-config.json',
      PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE || 'e2e-test-passphrase',
    },
  });
}

main().catch((err) => {
  console.error('Test script failed:', err);
  process.exit(1);
});
