#!/usr/bin/env bash
# Собственность Слепцова Дениса Владимировича. Разработчик кода — Слепцов Денис Владимирович.
# Сборка MON CHEF (Integrated Application 1.0 + Restaurant Service) и комплекта установки.
#   dist/MonChef_Integrated_Application_1_0_RS.zip  — архив сборки: загружается на Диск, не распаковывая
#   dist/Установка_MonChef_RS_<дата>.zip            — комплект: инструкция, архив сборки, установщик, руководства, документы
# Запуск: bash monchef/tools/build_kit.sh
set -euo pipefail
cd "$(dirname "$0")/.."
M=$(pwd); D=$(date +%Y-%m-%d); APP=MonChef_Integrated_Application_1_0_RS.zip; K="Установка_MonChef_RS_$D"
node tools/gen_manifest.js >/dev/null
node tools/gatecheck.js app | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);const bad=(r.calledButNotRegisteredList||[]).filter(x=>x!=="norm").length+(r.duplicateTopLevelFunctions||[]).length+(r.mutWithoutNeed||[]).length;if(bad){console.error("gatecheck:",s);process.exit(1)}})'
# PDF инструкций
for f in docs/ДОК_13_Установка_Restaurant_Service.md docs/ДОК_14_Restaurant_Service_инструкция_по_ролям.md; do python3 tools/md2pdf.py "$f" "${f%.md}.pdf" >/dev/null; done
T=$(mktemp -d); mkdir -p dist; rm -f dist/MonChef_*.zip dist/Установка_MonChef_*.zip
# 1) архив сборки — плоский: программа, логотипы, описание модулей и документы (их установщик кладёт в «Файлы пакета»)
mkdir -p "$T/app"; cp app/* "$T/app/"; cp docs/*.md docs/*.csv docs/*.pdf "$T/app/" 2>/dev/null || true
cp MON_CHEF_RESTAURANT_SERVICE_AUDIT.md RS_ЭТАП_*.md "$T/app/"
( cd "$T/app" && zip -q -X "$M/dist/$APP" * )
# 2) комплект
R="$T/$K"; mkdir -p "$R/2_Загрузить_на_Диск" "$R/3_Установщик" "$R/4_Для_персонала" "$R/5_Документы/Restaurant_Service"
cp docs/ДОК_13_Установка_Restaurant_Service.pdf "$R/1_Инструкция_по_установке.pdf"; cp docs/ДОК_13_Установка_Restaurant_Service.md "$R/1_Инструкция_по_установке.md"
cp dist/$APP "$R/2_Загрузить_на_Диск/"
cp install/MonChefInstaller.gs install/installer_appsscript.json "$R/3_Установщик/"
node tools/build_menu_demo.js >/dev/null && cp "dist/MonChef_Гостевое_меню_демо.html" "$R/6_Демо_гостевого_меню.html"
cp docs/ДОК_14_Restaurant_Service_инструкция_по_ролям.pdf docs/ДОК_14_Restaurant_Service_инструкция_по_ролям.md "$R/4_Для_персонала/"
cp docs/ДОК_*.md docs/ДОК_*.pdf docs/ДОК_8_Функции_и_роли.csv docs/Шаблон_таблицы_сроков.csv "$R/5_Документы/"
rm -f "$R/5_Документы/ДОК_13_"* "$R/5_Документы/ДОК_14_"*
cp MON_CHEF_RESTAURANT_SERVICE_AUDIT.md RS_ЭТАП_*.md ПЛАН_ОБЪЕДИНЕНИЯ.md "$R/5_Документы/Restaurant_Service/"
( cd "$T" && zip -q -r -X "$M/dist/$K.zip" "$K" )
rm -rf "$T"
sha256sum dist/*.zip
unzip -l "dist/$APP" | tail -1
