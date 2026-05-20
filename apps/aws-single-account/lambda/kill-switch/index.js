/* eslint-disable */
const { EC2Client, DescribeRegionsCommand, DescribeInstancesCommand, StopInstancesCommand } = require("@aws-sdk/client-ec2");
const { RDSClient, DescribeDBInstancesCommand, StopDBInstanceCommand, DescribeDBClustersCommand, StopDBClusterCommand } = require("@aws-sdk/client-rds");

exports.handler = async (event) => {
  console.log("Kill Switch Triggered! Event: ", JSON.stringify(event));
  
  // Dynamically fetch all enabled regions to ensure we catch resources
  // even if they were spawned outside the globally allowed regions.
  const ec2Global = new EC2Client({ region: 'us-east-1' });
  const regionsData = await ec2Global.send(new DescribeRegionsCommand({}));
  const regions = (regionsData.Regions || []).map(r => r.RegionName);
  
  console.log("Executing shutdown across regions:", regions.join(', '));
  
  for (const region of regions) {
    try {
      console.log(`Checking region ${region}...`);
      
      // Stop EC2
      const ec2 = new EC2Client({ region });
      const ec2Data = await ec2.send(new DescribeInstancesCommand({
        Filters: [{ Name: 'instance-state-name', Values: ['running'] }]
      }));
      
      const instanceIds = [];
      (ec2Data.Reservations || []).forEach(res => {
        (res.Instances || []).forEach(inst => instanceIds.push(inst.InstanceId));
      });

      if (instanceIds.length > 0) {
        console.log(`Stopping EC2 instances in ${region}: `, instanceIds);
        await ec2.send(new StopInstancesCommand({ InstanceIds: instanceIds }));
      }
      
      // Stop RDS
      const rds = new RDSClient({ region });
      
      const clusterData = await rds.send(new DescribeDBClustersCommand({}));
      for (const cluster of clusterData.DBClusters || []) {
        if (cluster.Status === 'available') {
          console.log(`Stopping RDS cluster ${cluster.DBClusterIdentifier} in ${region}`);
          await rds.send(new StopDBClusterCommand({ DBClusterIdentifier: cluster.DBClusterIdentifier }));
        }
      }

      const rdsData = await rds.send(new DescribeDBInstancesCommand({}));
      for (const db of rdsData.DBInstances || []) {
        if (db.DBInstanceStatus === 'available' && !db.DBClusterIdentifier) {
          console.log(`Stopping RDS instance ${db.DBInstanceIdentifier} in ${region}`);
          await rds.send(new StopDBInstanceCommand({ DBInstanceIdentifier: db.DBInstanceIdentifier }));
        }
      }
    } catch (e) {
      console.error(`Error processing region ${region}: `, e);
    }
  }
  return "Shutdown process completed";
};
