import * as pulumi from "@pulumi/pulumi";
import * as awsx from "@pulumi/awsx";
import * as aws from "@pulumi/aws";
import * as eks from "@pulumi/eks";

// Create an AWS resource (S3 Bucket)
const bucket = new aws.s3.Bucket("my-bucket");

// Export the name of the bucket
export const bucketName = bucket.id;

// Create an EKS cluster with the default configuration.
const cluster = new eks.Cluster("keks");

// Export the cluster's kubeconfig.
export const kubeconfig = cluster.kubeconfig;
