/* heroku_pg.ddl */

/* images */
drop table images;
create table if not exists images ( id varchar(50) not null primary key, body bytea, contenttype varchar(50) default '', filename varchar(256) default '', user_id varchar(100) default '', created bigint default 0, updated bigint default 0 );
