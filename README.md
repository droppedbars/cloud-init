# cloud-baseline

## 📝 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE.md) file for details.

## 👥 Code of Conduct

This project follows the Contributor Covenant Code of Conduct.

## Contributing

Contributions are welcome! Please see the [CONTRIBUTING.md](CONTRIBUTING.md) file for more information.

## Security

If you find a security issue, please report it by emailing [EMAIL_ADDRESS].

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0
- Pulumi CLI >= 3.0.0
- AWS CLI >= 2.0.0

### Installation

0. Install required software:
   - Install git: https://git-scm.com/downloads
   - Install pulumi: https://www.pulumi.com/docs/get-started/download-install/
   - Install Node.js: https://nodejs.org/en/download/ (npm is included)
   - Install AWS CLI: https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html

1. Clone the repository:

```bash
git clone https://github.com/your-org/cloud-baseline.git
cd cloud-baseline
```

2. Install dependencies:

```bash
npm install
```

3. Configure Pulumi:

```bash
pulumi login --local # remove --local to use pulumi account
```

### Usage

The expectation is you're using these scripts to setup the first security, governance, identity and budget guardrails in a new AWS account and are not planning to manage it long-term via Pulumi. If however you plan to manage it long-term via Pulumi, you should strongly consider forking this repository and adapting it to your needs and modifying the .gitignore file to persist the stack state files.

1. Select and initialize the app with a stack name

```bash
cd apps/<app-name>
pulumi stack init <stack-name>
pulumi config set aws:region <your-region>
pulumi config set org:subscriptionName <your-subscription-name>
```

2. Configure AWS credentials

```bash
aws login # login to AWS using your preferred method (e.g. SSO)
aws configure # configure AWS credentials such as access key, secret key, region, etc.
```

3. Deploy the app

```bash
pulumi preview # optional: preview the changes
pulumi up # apply the changes
```

4. Destroy the app

If for some reason the initial deployment fails or you want to redeploy, it's best to remove the stack first.

```bash
pulumi destroy # destroy the resources
pulumi stack rm # remove the stack state file
```

## 📚 Documentation

For detailed documentation, please see the [docs](docs) directory.
