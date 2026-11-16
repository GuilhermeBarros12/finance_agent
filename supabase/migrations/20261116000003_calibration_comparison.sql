-- P-17: registro estruturado da comparação durante a calibragem das tolerâncias.
--
-- Com `calibration_mode` ligado, o coletor publica o campo como `incomparable`, com as
-- duas observações, sem escolher lado, e com a comparação calculada (delta_abs, limite,
-- atol, rtol, versão da tolerância). A tolerância ainda não foi calibrada, então a
-- comparação não é defensável: por isso o estado é `incomparable` e não `verified` nem
-- `divergent`. Os números ficam em colunas próprias para a análise da T17, em vez de
-- texto livre no `reason`.
--
-- A regra antiga só admitia comparação em `verified` e `divergent`. A nova admite também
-- em `incomparable`, de forma opcional e completa (ou todos os campos, ou nenhum). Os
-- demais estados continuam sem comparação. As regras de `verified` e `divergent` não mudam.

alter table public.field_validations
  drop constraint field_validations_comparison_check;
alter table public.field_validations
  add constraint field_validations_comparison_check check (
    (status in ('verified', 'divergent')
      and delta_abs is not null and limit_value is not null
      and atol is not null and rtol is not null and tolerance_version is not null
      and delta_abs >= 0 and limit_value >= 0 and atol >= 0 and rtol >= 0)
    or (status = 'incomparable'
      and (
        (delta_abs is null and limit_value is null and atol is null and rtol is null
          and tolerance_version is null)
        or (delta_abs is not null and limit_value is not null
          and atol is not null and rtol is not null and tolerance_version is not null
          and delta_abs >= 0 and limit_value >= 0 and atol >= 0 and rtol >= 0)))
    or (status not in ('verified', 'divergent', 'incomparable')
      and delta_abs is null and limit_value is null and atol is null and rtol is null));

alter table public.staging_validations
  drop constraint staging_validations_comparison_check;
alter table public.staging_validations
  add constraint staging_validations_comparison_check check (
    (status in ('verified', 'divergent')
      and delta_abs is not null and limit_value is not null
      and atol is not null and rtol is not null and tolerance_version is not null
      and delta_abs >= 0 and limit_value >= 0 and atol >= 0 and rtol >= 0)
    or (status = 'incomparable'
      and (
        (delta_abs is null and limit_value is null and atol is null and rtol is null
          and tolerance_version is null)
        or (delta_abs is not null and limit_value is not null
          and atol is not null and rtol is not null and tolerance_version is not null
          and delta_abs >= 0 and limit_value >= 0 and atol >= 0 and rtol >= 0)))
    or (status not in ('verified', 'divergent', 'incomparable')
      and delta_abs is null and limit_value is null and atol is null and rtol is null));
