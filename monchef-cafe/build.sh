#!/usr/bin/env bash
# Сборка архива MON CHEF · Кафе для установщика: dist/MonChef_Cafe_Application_<дата>.zip
# (файлы программы в корне архива, как в MonChef_Integrated_Application_1_0_TTK.zip).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p dist
out="dist/MonChef_Cafe_Application_$(date +%Y-%m-%d).zip"
rm -f "$out"
(cd app && zip -q -X -r "../$out" .)
echo "$out ($(du -h "$out" | cut -f1))"
