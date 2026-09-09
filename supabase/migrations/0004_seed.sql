-- =====================================================================
-- Seed: contas, categorias base e regras de categorização automática
-- (as demais categorias entram pelo script de migração do Base44)
-- =====================================================================

insert into accounts (name, bank, opening_balance, color) values
  ('Cresol',        'Cresol',        0, '#2a78d6'),
  ('Mercado Pago',  'Mercado Pago',  0, '#eb6834'),
  ('Cora',          'Cora',          0, '#1baf7a')
on conflict (name) do nothing;

insert into categories (name, kind) values
  ('Dízimos e Ofertas',  'receita'),
  ('Dízimos',            'receita'),
  ('Ofertas',            'receita'),
  ('Missões',            'ambos'),
  ('Salários',           'despesa'),
  ('Alimentação',        'despesa'),
  ('Transporte',         'despesa'),
  ('Manutenção',         'despesa'),
  ('Eventos',            'despesa'),
  ('Saúde',              'despesa'),
  ('Estorno ou Devolução','ambos'),
  ('Outros',             'ambos')
on conflict (name) do nothing;

-- Regras equivalentes à categorização automática do sistema antigo,
-- agora editáveis pela tela de Categorias (sem precisar de deploy).
insert into category_rules (pattern, category_id, priority)
select v.pattern, c.id, v.priority
from (values
  ('transferencia pix recebida',      'Dízimos e Ofertas', 10),
  ('transferência pix recebida',      'Dízimos e Ofertas', 10),
  ('transferencia recebida',          'Dízimos e Ofertas', 11),
  ('pagamento com codigo qr pix',     'Dízimos e Ofertas', 12),
  ('pix credito',                     'Dízimos e Ofertas', 13),
  ('rec.pix',                         'Dízimos e Ofertas', 14),
  ('dizimo',                          'Dízimos',           20),
  ('oferta',                          'Ofertas',           21),
  ('supermercado',                    'Alimentação',       30),
  ('alimentacao',                     'Alimentação',       31),
  ('comida',                          'Alimentação',       32),
  ('combustivel',                     'Transporte',        40),
  ('gasolina',                        'Transporte',        41),
  ('transporte',                      'Transporte',        42),
  ('manutencao',                      'Manutenção',        50),
  ('reparo',                          'Manutenção',        51),
  ('evento',                          'Eventos',           60),
  ('festa',                           'Eventos',           61),
  ('salario',                         'Salários',          70),
  ('missao',                          'Missões',           80),
  ('missoes',                         'Missões',           81),
  ('saude',                           'Saúde',             90),
  ('hospital',                        'Saúde',             91)
) as v(pattern, cat, priority)
join categories c on c.name = v.cat
on conflict do nothing;
