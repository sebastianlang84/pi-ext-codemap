create virtual table if not exists chunks_fts using fts5(path, language, kind, text);
create virtual table if not exists symbols_fts using fts5(path, name, kind, signature);
