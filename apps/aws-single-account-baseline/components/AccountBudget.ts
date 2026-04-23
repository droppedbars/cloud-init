import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

export interface AccountBudgetArgs {
  limitAmount: string;
  limitUnit: string;
  subscriberEmailAddresses: string[];
}

export class AccountBudget extends pulumi.ComponentResource {
  constructor(name: string, args: AccountBudgetArgs, opts?: pulumi.ComponentResourceOptions) {
    super('cloud-baseline:billing:AccountBudget', name, args, opts);

    new aws.budgets.Budget(
      `${name}-monthly-budget`,
      {
        name: 'AccountBaselineMonthlyBudget',
        budgetType: 'COST',
        limitAmount: args.limitAmount,
        limitUnit: args.limitUnit,
        timeUnit: 'MONTHLY',
        notifications: [
          {
            comparisonOperator: 'GREATER_THAN',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
            notificationType: 'ACTUAL',
            subscriberEmailAddresses: args.subscriberEmailAddresses,
          },
          {
            comparisonOperator: 'GREATER_THAN',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
            notificationType: 'FORECASTED',
            subscriberEmailAddresses: args.subscriberEmailAddresses,
          },
        ],
      },
      { parent: this },
    );

    this.registerOutputs({});
  }
}
