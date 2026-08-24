-- ===========================================================================
-- ChamaHub - 17. Colore predefinito delle aree
-- ===========================================================================
-- L'applicazione ha adottato la tavolozza del profilo aziendale Chamanit. Il
-- valore predefinito della colonna era rimasto il blu di partenza: chi crea
-- un'area dal database, o senza scegliere un colore, si ritrovava una tinta
-- estranea al marchio.
--
-- Le aree gia' esistenti NON vengono toccate: il colore di un'area e' una
-- scelta di chi la gestisce, e riscriverla d'ufficio significherebbe cambiare
-- sotto gli occhi dell'HR pastiglie e grafici a cui e' abituato. Chi vuole
-- allinearle riapre l'area e ripesca il colore dalla nuova tavolozza.
-- ===========================================================================

alter table public.areas
  alter column color set default '#3a5fc0';

comment on column public.areas.color is
  'Colore identitario dell''area, usato in pastiglie, calendario e grafici. La tavolozza proposta dall''interfaccia e'' in lib/chart-colors.ts.';
