-- ===========================================================================
-- ChamaHub - 08. Contenuti predefiniti
-- ===========================================================================
-- Un modello di valutazione, un modello di autovalutazione e un questionario di
-- gradimento pronti all'uso, cosi' che l'applicazione sia utilizzabile dal
-- primo accesso. L'HR puo' modificarli o disattivarli dall'interfaccia.
-- Gli inserimenti sono idempotenti.
-- ===========================================================================

do $$
declare
  v_template uuid;
  v_self uuid;
  v_survey uuid;
begin
  -- -------------------------------------------------------------------------
  -- Scheda di valutazione del dipendente
  -- -------------------------------------------------------------------------
  select id into v_template from public.evaluation_templates
  where name = 'Valutazione annuale - standard';

  if v_template is null then
    insert into public.evaluation_templates (name, description, target)
    values (
      'Valutazione annuale - standard',
      'Modello di partenza per la valutazione del dipendente da parte del responsabile di area.',
      'employee'
    )
    returning id into v_template;

    insert into public.evaluation_questions
      (template_id, position, label, help_text, type, scale_min, scale_max, weight, is_required)
    values
      (v_template, 1, 'Qualita'' del lavoro svolto',
       'Accuratezza, cura del dettaglio e affidabilita'' dei risultati consegnati.',
       'scale', 1, 5, 1.5, true),
      (v_template, 2, 'Autonomia e capacita'' di iniziativa',
       'Capacita'' di procedere senza supervisione costante e di proporre soluzioni.',
       'scale', 1, 5, 1, true),
      (v_template, 3, 'Collaborazione e lavoro di squadra',
       'Disponibilita'' verso i colleghi e contributo al clima dell''area.',
       'scale', 1, 5, 1, true),
      (v_template, 4, 'Rispetto di scadenze e priorita''',
       null, 'scale', 1, 5, 1, true),
      (v_template, 5, 'Competenze tecniche di ruolo',
       'Padronanza degli strumenti e delle conoscenze richieste dalla posizione.',
       'scale', 1, 5, 1.5, true),
      (v_template, 6, 'Comunicazione',
       'Chiarezza e puntualita'' nello scambio di informazioni.',
       'scale', 1, 5, 1, true),
      (v_template, 7, 'Punti di forza osservati',
       'Testo libero, facoltativo.', 'text', 1, 5, 1, false),
      (v_template, 8, 'Aree di miglioramento e obiettivi per il prossimo periodo',
       'Testo libero, facoltativo.', 'text', 1, 5, 1, false);
  end if;

  -- -------------------------------------------------------------------------
  -- Scheda di autovalutazione (compilata dal responsabile su se stesso)
  -- -------------------------------------------------------------------------
  select id into v_self from public.evaluation_templates
  where name = 'Autovalutazione responsabile - standard';

  if v_self is null then
    insert into public.evaluation_templates (name, description, target)
    values (
      'Autovalutazione responsabile - standard',
      'Modello di autovalutazione destinato ai responsabili di area.',
      'self'
    )
    returning id into v_self;

    insert into public.evaluation_questions
      (template_id, position, label, help_text, type, scale_min, scale_max, weight, is_required)
    values
      (v_self, 1, 'Raggiungimento degli obiettivi di area',
       null, 'scale', 1, 5, 1.5, true),
      (v_self, 2, 'Gestione e sviluppo delle persone',
       'Ascolto, delega, crescita dei collaboratori.', 'scale', 1, 5, 1.5, true),
      (v_self, 3, 'Organizzazione del lavoro e delle priorita''',
       null, 'scale', 1, 5, 1, true),
      (v_self, 4, 'Comunicazione verso il team e verso l''azienda',
       null, 'scale', 1, 5, 1, true),
      (v_self, 5, 'Gestione delle criticita''',
       null, 'scale', 1, 5, 1, true),
      (v_self, 6, 'Risultati di cui sono piu'' soddisfatto',
       'Testo libero, facoltativo.', 'text', 1, 5, 1, false),
      (v_self, 7, 'Su cosa voglio lavorare nel prossimo periodo',
       'Testo libero, facoltativo.', 'text', 1, 5, 1, false),
      (v_self, 8, 'Supporto che mi servirebbe dall''azienda',
       'Testo libero, facoltativo.', 'text', 1, 5, 1, false);
  end if;

  -- -------------------------------------------------------------------------
  -- Questionario di gradimento (anonimo, sempre aperto)
  -- -------------------------------------------------------------------------
  select id into v_survey from public.satisfaction_surveys
  where name = 'Gradimento del lavoro';

  if v_survey is null then
    insert into public.satisfaction_surveys (name, description, is_active)
    values (
      'Gradimento del lavoro',
      'Questionario anonimo sul benessere e la soddisfazione lavorativa. Le risposte non sono in alcun modo riconducibili a chi le ha inviate: vengono aggregate per area e mostrate solo quando le risposte raccolte sono sufficienti a garantire l''anonimato.',
      true
    )
    returning id into v_survey;

    insert into public.satisfaction_questions
      (survey_id, position, label, help_text, type, scale_min, scale_max, weight, is_required)
    values
      (v_survey, 1, 'Quanto sei soddisfatto del tuo lavoro in generale?',
       null, 'scale', 1, 5, 2, true),
      (v_survey, 2, 'Il carico di lavoro e'' sostenibile',
       null, 'scale', 1, 5, 1, true),
      (v_survey, 3, 'Ho gli strumenti e le informazioni che mi servono per lavorare bene',
       null, 'scale', 1, 5, 1, true),
      (v_survey, 4, 'Il rapporto con i colleghi della mia area e'' positivo',
       null, 'scale', 1, 5, 1, true),
      (v_survey, 5, 'Mi sento ascoltato dal mio responsabile',
       null, 'scale', 1, 5, 1.5, true),
      (v_survey, 6, 'Ricevo riscontri utili sul mio lavoro',
       null, 'scale', 1, 5, 1, true),
      (v_survey, 7, 'Ho possibilita'' di crescita e di apprendimento',
       null, 'scale', 1, 5, 1, true),
      (v_survey, 8, 'L''equilibrio fra vita privata e lavoro e'' rispettato',
       null, 'scale', 1, 5, 1, true),
      (v_survey, 9, 'Consiglieresti a un amico di lavorare qui?',
       'Da 1 = assolutamente no a 5 = senza dubbio.', 'scale', 1, 5, 1.5, true),
      (v_survey, 10, 'Cosa funziona bene e va mantenuto?',
       'Testo libero, facoltativo.', 'text', 1, 5, 1, false),
      (v_survey, 11, 'Cosa cambieresti?',
       'Testo libero, facoltativo.', 'text', 1, 5, 1, false);
  end if;
end $$;
