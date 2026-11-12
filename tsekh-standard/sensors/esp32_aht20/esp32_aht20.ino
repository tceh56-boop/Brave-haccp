// ЦЕХ Стандарт — прошивка датчика температуры и влажности.
// Плата: ESP32 (любая с Wi-Fi 2.4 ГГц). Модуль: AHT20 и совместимые (Winsen, I2C, адрес 0x38).
// Подключение модуля: VCC → 3V3, GND → GND, SDA → GPIO21, SCL → GPIO22.
// Arduino IDE: плата «ESP32 Dev Module», пакет esp32 от Espressif. Подробно — sensors/README.md.
//
// Что делает: раз в SEND_EVERY_SEC секунд снимает три замера, берёт медиану и отправляет в систему
// POST {"device","token","value","humidity","rssi"}. Система пишет в журнал показание во время проверок объекта
// (если у объекта автоматический ввод) и каждое отклонение. При отклонении (ответ result=FAIL) мигает светодиод на плате.
// Нет Wi-Fi или датчика — ничего не отправляется: задача замера в «Сейчас» остаётся повару.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include "aht20.h"

// ======================= НАСТРОЙКИ (заполнить) =======================
const char* WIFI_SSID = "";             // сеть Wi-Fi 2.4 ГГц
const char* WIFI_PASS = "";
// Три строки ниже — из окна «Датчик подключён» в системе (Настройка и готовность → Оборудование → Датчик)
const char* TS_URL    = "";             // адрес системы, https://script.google.com/macros/s/…/exec
const char* TS_DEVICE = "";             // SNS-000001
const char* TS_TOKEN  = "";             // ключ датчика (показывается один раз)
const bool  SEND_HUMIDITY = true;       // влажность учитывается только для помещений (склад)
const uint32_t SEND_EVERY_SEC = 300;    // раз в 5 минут; чаще 2 раз в минуту система не принимает
const int PIN_SDA = 21, PIN_SCL = 22, PIN_LED = 2;
// Корневой сертификат Google (GTS Root R1) — скачать https://pki.goog/repo/certs/gtsr1.pem и вставить целиком.
// Пусто — соединение шифруется, но сервер не проверяется (ключ датчика можно перехватить в чужой сети).
const char* TS_CA_PEM = "";
// ======================================================================

static int failsInRow = 0;

bool ahtWrite(const uint8_t* cmd) {
  Wire.beginTransmission(aht20::ADDR);
  Wire.write(cmd, 3);
  return Wire.endTransmission() == 0;
}

bool ahtInit() {
  delay(40);
  Wire.requestFrom(aht20::ADDR, (uint8_t)1);
  if (!Wire.available()) return false;
  uint8_t st = Wire.read();
  if (!(st & 0x08)) { ahtWrite(aht20::CMD_INIT); delay(10); }
  return true;
}

// Один замер; false — модуль не ответил или ответ испорчен.
bool ahtRead(float& t, float& h) {
  for (int attempt = 0; attempt < 3; attempt++) {
    if (!ahtWrite(aht20::CMD_MEASURE)) { ahtInit(); continue; }
    delay(85);
    uint8_t r[7] = {0};
    if (Wire.requestFrom(aht20::ADDR, (uint8_t)7) != 7) continue;
    for (int i = 0; i < 7; i++) r[i] = Wire.read();
    aht20::Status s = aht20::decode(r, t, h);
    if (s == aht20::OK) return true;
    if (s == aht20::NOT_CALIBRATED) ahtInit();
    delay(50);
  }
  return false;
}

bool readMedian(float& t, float& h) {
  float ts[3], hs[3];
  for (int i = 0; i < 3; i++) {
    if (!ahtRead(ts[i], hs[i])) return false;
    if (i < 2) delay(2000);
  }
  t = aht20::median3(ts[0], ts[1], ts[2]);
  h = aht20::median3(hs[0], hs[1], hs[2]);
  return true;
}

bool wifiUp() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) delay(500);
  return WiFi.status() == WL_CONNECTED;
}

void blink(int n) {
  for (int i = 0; i < n; i++) { digitalWrite(PIN_LED, HIGH); delay(150); digitalWrite(PIN_LED, LOW); delay(150); }
}

// Отправка. Apps Script отвечает перенаправлением 302 — его нужно пройти (ответ системы лежит по новому адресу).
String send(float t, float h) {
  WiFiClientSecure client;
  if (TS_CA_PEM[0]) client.setCACert(TS_CA_PEM); else client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.setTimeout(20000);
  if (!http.begin(client, TS_URL)) return "";
  http.addHeader("Content-Type", "application/json");
  String body = String("{\"device\":\"") + TS_DEVICE + "\",\"token\":\"" + TS_TOKEN + "\",\"value\":" + String(t, 1);
  if (SEND_HUMIDITY) body += ",\"humidity\":" + String(h, 0);
  body += ",\"rssi\":" + String((int)WiFi.RSSI());   // уровень Wi-Fi: в системе видно, почему датчик пропадает
  body += "}";
  int code = http.POST(body);
  String resp = code > 0 ? http.getString() : "";
  http.end();
  Serial.printf("HTTP %d %s\n", code, resp.c_str());
  return code == 200 ? resp : "";
}

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
  Wire.begin(PIN_SDA, PIN_SCL);
  Wire.setClock(100000);
  if (!ahtInit()) Serial.println("Модуль не найден: проверьте провода SDA/SCL и питание 3.3 В");
  if (!TS_CA_PEM[0]) Serial.println("Внимание: сертификат Google не задан, сервер не проверяется");
}

void loop() {
  uint32_t started = millis();
  float t, h;
  if (!readMedian(t, h)) {
    Serial.println("Нет ответа модуля — показание не отправлено");
    blink(2);
  } else {
    Serial.printf("t=%.1f °C  h=%.0f %%\n", t, h);
    String resp = wifiUp() ? send(t, h) : "";
    if (resp.indexOf("\"ok\":true") < 0) {
      if (++failsInRow >= 6) ESP.restart();  // полчаса без связи — перезапуск платы
    } else {
      failsInRow = 0;
      if (resp.indexOf("\"result\":\"FAIL\"") >= 0) blink(10);
    }
  }
  uint32_t spent = millis() - started;
  if (spent < SEND_EVERY_SEC * 1000UL) delay(SEND_EVERY_SEC * 1000UL - spent);
}
