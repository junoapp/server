# Awesome Project Build with TypeORM

Steps to run this project:

1. Run `npm i` command
2. Setup database settings inside `ormconfig.json` file
3. Run `npm start` command

`docker run -d -p 8123:8123 --name clickhouse-server --ulimit nofile=262144:262144 --volume="/Users/paulomenezes/data/clickhouse":/var/lib/clickhouse yandex/clickhouse-server`

`docker pull yandex/clickhouse-client`

`docker run -it --rm --link clickhouse-server:clickhouse-server yandex/clickhouse-client --host clickhouse-server`

`CREATE DATABASE juno;`
