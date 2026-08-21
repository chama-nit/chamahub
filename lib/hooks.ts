"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

interface Settled<T> {
  key: string;
  data: T | null;
  error: string | null;
}

/**
 * Esegue una funzione asincrona al montaggio e ogni volta che cambiano le
 * dipendenze, esponendo dati, stato di caricamento ed errore.
 *
 * Lo stato di caricamento non e' una variabile a se': si ricava confrontando la
 * chiave delle dipendenze correnti con quella dell'ultimo risultato ottenuto.
 * Cosi' non serve alcun setState sincrono dentro l'effetto (che provocherebbe
 * un doppio render) e le risposte di chiamate ormai superate vengono scartate
 * da sole, senza lasciare a schermo un dato vecchio.
 */
export function useAsync<T>(
  factory: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> {
  const [nonce, setNonce] = useState(0);
  const [settled, setSettled] = useState<Settled<T> | null>(null);

  // Chiave che riassume le dipendenze: e' una stringa, quindi confrontabile
  // per valore e utilizzabile come unica dipendenza dell'effetto.
  const key = `${nonce}:${JSON.stringify(deps)}`;

  // La factory cambia identita' a ogni render: la si conserva in un ref
  // aggiornato dopo il commit, in modo che l'effetto dipenda solo dalla chiave.
  const factoryRef = useRef(factory);
  useEffect(() => {
    factoryRef.current = factory;
  });

  useEffect(() => {
    let active = true;

    factoryRef.current().then(
      (result) => {
        if (active) setSettled({ key, data: result, error: null });
      },
      (err: unknown) => {
        if (!active) return;
        setSettled({
          key,
          data: null,
          error: err instanceof Error
            ? err.message
            : "Caricamento non riuscito.",
        });
      },
    );

    return () => {
      active = false;
    };
  }, [key]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  const fresh = settled?.key === key ? settled : null;

  return {
    data: fresh?.data ?? null,
    loading: fresh === null,
    error: fresh?.error ?? null,
    reload,
  };
}
