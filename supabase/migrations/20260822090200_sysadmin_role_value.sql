-- ===========================================================================
-- ChamaHub - 14. Il valore 'sysadmin' nel tipo dei ruoli
-- ===========================================================================
-- Questa migrazione fa una cosa sola: aggiunge il valore all'enumerazione.
--
-- Non e' pigrizia, e' un vincolo di PostgreSQL: un valore aggiunto a un tipo
-- enumerato non puo' essere usato nella stessa transazione in cui viene
-- creato. Siccome ogni file di migrazione viene applicato dentro una
-- transazione, tutto cio' che usa 'sysadmin' - funzioni, policy, script - vive
-- nella migrazione successiva.
-- ===========================================================================

alter type public.user_role add value if not exists 'sysadmin';
