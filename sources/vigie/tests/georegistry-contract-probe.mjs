// Diagnostic temporaire : contrat public GeoRegistry, adresse de la documentation (Angers).
const q = new URLSearchParams({ adresse:'12 rue de la Roë Angers', type_local:'1', radius:'5000', limit:'5' });
try {
  const response = await fetch('https://georegistry.fr/api/v1/dvf/ventes/address?' + q, {
    signal: AbortSignal.timeout(9000), headers: { accept: 'application/json' },
  });
  console.log('PROBE_HTTP_STATUS', response.status);
  if (!response.ok) process.exit(0);
  const body = await response.json();
  console.log('PROBE_DATA_SHAPE', Array.isArray(body.data) ? 'array' : typeof body.data, 'count', body.data?.length);
  console.log('PROBE_META_KEYS', Object.keys(body.meta || {}));
  for (const sale of (Array.isArray(body.data) ? body.data.slice(0, 4) : [])) {
    console.log('PROBE_FIELDS', Object.keys(sale));
    console.log('PROBE_VALUES', JSON.stringify({
      type_local:sale.type_local, mutation_date:sale.mutation_date, date_mutation:sale.date_mutation,
      nature:sale.nature, nature_mutation:sale.nature_mutation, surface_bati:sale.surface_bati,
      prix_m2:sale.prix_m2, valeur_fonciere:sale.valeur_fonciere,
      distance_m:sale.distance_m, id_mutation:sale.id_mutation,
    }));
  }
} catch (error) { console.log('PROBE_UNAVAILABLE', error.name, error.message); }
