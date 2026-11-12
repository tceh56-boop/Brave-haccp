// ЦЕХ Стандарт — расчёт показаний модуля температуры и влажности AHT20 (I2C, адрес 0x38)
// и совместимых модулей (Winsen и др. с теми же характеристиками: ±0.3 °C, ±2 %RH, −40…+80 °C).
// Только вычисления, без обращения к шине — проверяется на компьютере (tests/aht20_test.cpp).
#pragma once
#include <stdint.h>

namespace aht20 {

const uint8_t ADDR = 0x38;
const uint8_t CMD_INIT[3] = {0xBE, 0x08, 0x00};     // калибровка (AHT20); AHT10 — 0xE1
const uint8_t CMD_MEASURE[3] = {0xAC, 0x33, 0x00};  // запуск замера, результат через ≥80 мс

// CRC-8: полином 0x31, начальное значение 0xFF — по документации AHT20.
inline uint8_t crc8(const uint8_t* d, int n) {
  uint8_t c = 0xFF;
  for (int i = 0; i < n; i++) {
    c ^= d[i];
    for (int b = 0; b < 8; b++) c = (c & 0x80) ? (uint8_t)((c << 1) ^ 0x31) : (uint8_t)(c << 1);
  }
  return c;
}

enum Status { OK = 0, BUSY = 1, NOT_CALIBRATED = 2, BAD_CRC = 3 };

// r — 7 байт ответа: состояние, 20 бит влажности, 20 бит температуры, CRC.
inline Status decode(const uint8_t r[7], float& tempC, float& rh) {
  if (r[0] & 0x80) return BUSY;
  if (!(r[0] & 0x08)) return NOT_CALIBRATED;
  if (crc8(r, 6) != r[6]) return BAD_CRC;
  uint32_t h = ((uint32_t)r[1] << 12) | ((uint32_t)r[2] << 4) | (r[3] >> 4);
  uint32_t t = (((uint32_t)r[3] & 0x0F) << 16) | ((uint32_t)r[4] << 8) | r[5];
  rh = h * 100.0f / 1048576.0f;
  tempC = t * 200.0f / 1048576.0f - 50.0f;
  return OK;
}

// Медиана трёх замеров — одиночный выброс (помеха на проводе, открытая дверь) не уходит в журнал.
inline float median3(float a, float b, float c) {
  if (a > b) { float x = a; a = b; b = x; }
  if (b > c) { float x = b; b = c; c = x; }
  if (a > b) { float x = a; a = b; b = x; }
  return b;
}

}  // namespace aht20
