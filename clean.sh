docker ps -q | xargs -r docker kill
docker stop tealscript-compiler
docker rm tealscript-compiler