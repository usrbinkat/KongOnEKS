#!/bin/bash -x
git_repo=KongOnEKS
project="deploy-${git_repo}"
tmpDir="${HOME}/Git/tmp/pulumi-runner"

rm -fr ${tmpDir}
mkdir -p ${tmpDir}/{ssh,aws,kube,gitconfig}
cp -fr ${HOME}/.gitconfig ${tmpDir}/gitconfig
cp -fr ${HOME}/.kube ${tmpDir}/kube
cp -fr ${HOME}/.aws ${tmpDir}/aws
cp -fr ${HOME}/.ssh ${tmpDir}/ssh

docker run -it --rm --pull always \
    -v ${PWD}:/pulumi:z \
    --env-file /tmp/env \
    --entrypoint pulumi \
    --name "${project}" -h "${project}" --user root \
   ghcr.io/usrbinkat/pulumi-runner \
     up --stack KongOnEKS --yes --cwd /pulumi/pulumi --non-interactive
