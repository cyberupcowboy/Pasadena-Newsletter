insert into public.locations (name, location_type, parent_name, radius_miles) values
  ('Pasadena','community','Anne Arundel County',8),
  ('Lake Shore','neighborhood','Pasadena',4),
  ('Riviera Beach','neighborhood','Pasadena',3),
  ('Green Haven','neighborhood','Pasadena',3),
  ('Jacobsville','neighborhood','Pasadena',3),
  ('Anne Arundel County','county','Maryland',null),
  ('Maryland','state','United States',null),
  ('United States','national',null,null)
on conflict (name, location_type) do nothing;

insert into public.sources (name, source_type, base_url, trust_score, active) values
  ('Anne Arundel County Government','official','https://www.aacounty.org',95,true),
  ('Anne Arundel County Police','official','https://www.aacounty.org/police-department',95,true),
  ('Anne Arundel County Public Library','official','https://www.aacpl.net',95,true),
  ('Anne Arundel County Public Schools','official','https://www.aacps.org',95,true),
  ('Maryland Department of Natural Resources','official','https://dnr.maryland.gov',95,true);
