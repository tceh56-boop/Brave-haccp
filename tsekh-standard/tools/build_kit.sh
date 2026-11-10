#!/usr/bin/env bash
# Полный комплект установки (как «Установка_MonChef_…»): dist/Установка_ЦЕХ_Стандарт_<дата>.zip
set -euo pipefail
cd "$(dirname "$0")/.."
bash tools/build.sh >/dev/null
D=$(date +%Y-%m-%d); K="Установка_ЦЕХ_Стандарт_$D"; T=$(mktemp -d); R="$T/$K"
mkdir -p "$R/2_Загрузить_на_Диск" "$R/3_Установщик" "$R/4_Админ-панель" "$R/5_Документы" "$R/6_Логотипы"
cp docs/ДОК_12_Развёртывание_распознавание_почта.md "$R/1_Инструкция_развёртывание_распознавание_почта.md"
cp dist/TsekhStandard_Application.zip "$R/2_Загрузить_на_Диск/"
cp installer/TsekhInstaller.gs "$R/3_Установщик/"; cp installer/appsscript.json "$R/3_Установщик/appsscript.json"
cp admin/*.gs admin/*.html admin/appsscript.json "$R/4_Админ-панель/"
cp README.md "$R/5_Документы/README_ЦЕХ_Стандарт.md"; cp docs/ДОК_*.md docs/ДОК_*.pdf docs/ДОК_8_Функции_и_роли.csv docs/Шаблон_таблицы_сроков.csv "$R/5_Документы/"
cp brand/*.png "$R/6_Логотипы/"
rm -f dist/Установка_*.zip
( cd "$T" && zip -q -r -X "$OLDPWD/dist/$K.zip" "$K" )
rm -rf "$T"; ls -la dist
