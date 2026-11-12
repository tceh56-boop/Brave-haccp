-- Строки распознанного документа, уже принятые в приёмку одним действием: повторно не принимаются (защита от двойного прихода).
alter table recognition_documents add column applied_lines integer[] not null default '{}';
grant update (applied_lines) on recognition_documents to ceh_app;
