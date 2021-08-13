# KongOnEKS | Status: *rough draft*

Pulumi IaC for EKS

## Clone & Run IaC

```sh
git clone https://github.com/usrbinkat/KongOnEKS ~/KongOnEKS && cd ~/KongOnEKS

# Run IaC Runner Container (local)
./hack/dev.sh

# Install NPM Packages
npm install

# Create Stack
pulumi stack init usrbinkat/Gateway/KongHybridGatewayOnEKS
pulumi config set --secret kong:dbPassword password
pulumi config set aws:region us-east-1
pulumi config set eksCluster:clusterName KongOnEKS
pulumi up
```

## Workarounds to be resolved later

```sh
kubectl create secret generic kong-enterprise-license -n kong --from-file=license=${HOME}/.kong-license-data/license.json
podman run -it --rm --pull always --user root -v /tmp/kong:/tmp/kong:z docker.io/kong/kong -- kong hybrid gen_cert /tmp/kong/tls.crt /tmp/kong/tls.key
kubectl create secret tls kong-cluster-cert --namespace kong --cert=/tmp/kong/tls.crt --key=/tmp/kong/tls.key
kubectl create secret generic kong-enterprise-superuser-password -n kong --from-literal=password='password'
```
