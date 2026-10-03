# ЦЕХ — Stage 30 Unified Master Data

## Назначение
Единый registry поверх существующих справочников без замены их первичных ключей.
Registry хранит организационный scope, canonical name, статус, версию и aliases.

## Принципы
- существующие PRODUCTS/SUPPLIERS/DISHES и др. остаются source-of-truth;
- MASTER_DATA_REGISTRY не копирует финансовые/складские факты;
- дубль только предлагается/объединяется явно;
- cross-tenant access запрещён;
- alias уникален внутри scope;
- merge помечает source как MERGED, физического удаления нет.
