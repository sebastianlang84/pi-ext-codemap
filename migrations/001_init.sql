create table if not exists meta (key text primary key, value text not null);
create table if not exists files (
  id integer primary key,
  path text not null unique,
  language text not null,
  size integer not null,
  hash text not null,
  mtime_ms real not null,
  indexed_at text not null
);
create table if not exists chunks (
  id integer primary key,
  file_id integer not null references files(id) on delete cascade,
  ordinal integer not null,
  start_line integer not null,
  end_line integer not null,
  kind text not null,
  text text not null,
  unique(file_id, ordinal)
);
create table if not exists symbols (
  id integer primary key,
  file_id integer not null references files(id) on delete cascade,
  name text not null,
  kind text not null,
  start_line integer not null,
  end_line integer,
  signature text
);
