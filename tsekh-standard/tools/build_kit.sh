#!/usr/bin/env bash
# Полный комплект установки (как «Установка_MonChef_…»): dist/Установка_ЦЕХ_Стандарт_<дата>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
bash tools/build.sh >/dev/null
D=$(date +%Y-%m-%d); K="Установка_ЦЕХ_Стандарт_$D"; T=$(mktemp -d); R="$T/$K"
mkdir -p "$R/2_Загрузить_на_Диск" "$R/3_Установщик" "$R/4_Для_персонала" "$R/5_Админ-панель" "$R/6_Документы" "$R/7_Логотипы"
cp docs/ДОК_12_Развёртывание_распознавание_почта.md "$R/1_Инструкция_развёртывание_распознавание_почта.md"
cp dist/TsekhStandard_Application.zip "$R/2_Загрузить_на_Диск/"
cp installer/TsekhInstaller.gs "$R/3_Установщик/"; cp installer/appsscript.json "$R/3_Установщик/appsscript.json"
cp dist/manuals/*.pdf "$R/4_Для_персонала/"
cp admin/*.gs admin/*.html admin/appsscript.json "$R/5_Админ-панель/"
cp README.md "$R/6_Документы/README_ЦЕХ_Стандарт.md"; cp docs/ДОК_*.md docs/ДОК_*.pdf docs/ДОК_8_Функции_и_роли.csv docs/Шаблон_таблицы_сроков.csv "$R/6_Документы/"
cp brand/*.png "$R/7_Логотипы/"
rm -f dist/Установка_*.zip
( cd "$T" && zip -q -r -X "$OLDPWD/dist/$K.zip" "$K" )
rm -rf "$T"; ls -la dist
