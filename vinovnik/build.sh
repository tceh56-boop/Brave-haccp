#!/usr/bin/env bash
# Сборка VINOVNIK: архив программы для установщика и установочный комплект.
#   dist/MonChef_VINOVNIK_Application_<дата>.zip — программа (установщик ищет MonChef*.zip; файлы в корне архива)
#   dist/Установка_VINOVNIK_<дата>.zip           — инструкция, установщик, документы, аудит, логотип
set -euo pipefail
cd "$(dirname "$0")"
python3 tools/apply_vinovnik.py >/dev/null
d=$(date +%Y-%m-%d); mkdir -p dist
app="dist/MonChef_VINOVNIK_Application_$d.zip"; rm -f "$app"
(cd app && zip -q -X -r "../$app" .)
kit="dist/Установка_VINOVNIK_$d"; rm -rf "$kit" "$kit.zip"
mkdir -p "$kit/2_Загрузить_на_Диск" "$kit/3_Установщик" "$kit/4_Для_персонала" "$kit/5_Документы"
cp README.md "$kit/0_VINOVNIK_README.md"
cp docs/1_Инструкция_по_установке_MON_CHEF.md "$kit/1_Инструкция_по_установке.md"
cp "$app" "$kit/2_Загрузить_на_Диск/"
cp installer/* "$kit/3_Установщик/"
cp docs/VINOVNIK_Инструкция_для_зала.md "$kit/4_Для_персонала/"
cp docs/Аудит_MonChef_2026-10-13_9.md "$kit/5_Документы/"
[ -f docs/Аудит_MonChef_2026-10-13_9.docx ] && cp docs/*.docx "$kit/5_Документы/"
cp brand/logo_original.jpg "$kit/5_Документы/VINOVNIK_логотип.jpg"
(cd dist && zip -q -X -r "$(basename "$kit").zip" "$(basename "$kit")") && rm -rf "$kit"
echo "$app ($(du -h "$app" | cut -f1))"; echo "$kit.zip ($(du -h "$kit.zip" | cut -f1))"
