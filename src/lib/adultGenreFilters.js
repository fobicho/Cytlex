export const isAdultGenreOption = (option) => {
  const label = String(option?.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /\+1[89](?:\b|$)|\b(?:Erotica|Ecchi|Yaoi|BL|boys)\b|\bboys\s+love\b|\bboyslove\b/i.test(label);
};

export function withAdultGenreExclusions(sourceId, params, filters, showAdultExtensions) {
  if (sourceId !== 'zonatmo' || showAdultExtensions) return params;
  const adultIds = [...new Set((Array.isArray(filters) ? filters : [])
    .filter((filter) => filter.id === 'gender' || filter.id === 'excludeGender')
    .flatMap((filter) => (filter.options || [])
      .filter(isAdultGenreOption)
      .map((option) => option.value))
  )];
  adultIds.push('19');
  const ids = new Set(adultIds);
  const included = Array.isArray(params.gender) ? params.gender : params.gender ? [params.gender] : [];
  const excluded = Array.isArray(params.excludeGender) ? params.excludeGender : params.excludeGender ? [params.excludeGender] : [];
  return {
    ...params,
    gender: included.filter((id) => !ids.has(id)),
    excludeGender: [...new Set([...excluded, ...adultIds])]
  };
}
