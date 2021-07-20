#!/bin/bash -x
git_repo=KongOnEKS
project="${git_repo}"
tmpDir="${HOME}/Git/tmp/pulumi-runner"

rm -fr ${tmpDir}
mkdir -p ${tmpDir}/{ssh,aws,kube,gitconfig}
cp -fr ${HOME}/.gitconfig ${tmpDir}/gitconfig
cp -fr ${HOME}/.kube ${tmpDir}/kube
cp -fr ${HOME}/.aws ${tmpDir}/aws
cp -fr ${HOME}/.ssh ${tmpDir}/ssh

sudo docker rm --force ${project}
docker run -it --pull always \
    -v ${PWD}:/pulumi:z \
    -v ${tmpDir}/ssh/.ssh:/root/.ssh:z \
    -v ${tmpDir}/aws/.aws:/root/.aws:z \
    -v ${tmpDir}/kube/.kube:/root/.kube:z \
    -v ${tmpDir}/gitconfig/.gitconfig:/root/.gitconfig:z \
    --name "${project}" -h "${project}" --user root \
   ghcr.io/usrbinkat/pulumi-runner
