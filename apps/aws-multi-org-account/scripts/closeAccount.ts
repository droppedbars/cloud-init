import { OrganizationsClient, CloseAccountCommand } from '@aws-sdk/client-organizations';

async function main() {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error('No account ID provided.');
    process.exit(1);
  }

  try {
    const client = new OrganizationsClient({});
    console.log(`Attempting to close account ${accountId}...`);
    const command = new CloseAccountCommand({ AccountId: accountId });
    await client.send(command);
    console.log(`Successfully closed account ${accountId}.`);
  } catch (e: any) {
    if (
      e.name === 'AccountAlreadyClosedException' ||
      e.name === 'ConstraintViolationException' ||
      e.message?.includes('Account is already closed')
    ) {
      console.log(`Account ${accountId} is already closed or cannot be closed cleanly.`);
      process.exit(0);
    }
    console.error(`Failed to close account ${accountId}:`, e);
    process.exit(1);
  }
}

main();
