// Проверка расчёта AHT20: g++ -std=c++11 -I sensors/esp32_aht20 tests/aht20_test.cpp -o /tmp/aht && /tmp/aht
#include <cassert>
#include <cmath>
#include <cstdio>
#include "aht20.h"

static void pack(uint8_t r[7], uint32_t h, uint32_t t, uint8_t st) {
  r[0] = st; r[1] = h >> 12; r[2] = (h >> 4) & 0xFF; r[3] = ((h & 0x0F) << 4) | ((t >> 16) & 0x0F);
  r[4] = (t >> 8) & 0xFF; r[5] = t & 0xFF; r[6] = aht20::crc8(r, 6);
}

int main() {
  // CRC из документации AHT20: crc8({0xBE, 0xEF}) у полинома 0x31/0xFF = 0x92
  const uint8_t ex[2] = {0xBE, 0xEF};
  assert(aht20::crc8(ex, 2) == 0x92);

  float t, h; uint8_t r[7];
  // +4.0 °C, 50 %RH: t_raw = (4+50)/200·2^20, h_raw = 0.5·2^20
  pack(r, 524288, (uint32_t)lround(54.0 / 200.0 * 1048576.0), 0x18);
  assert(aht20::decode(r, t, h) == aht20::OK);
  assert(std::fabs(t - 4.0f) < 0.01f && std::fabs(h - 50.0f) < 0.01f);
  // −18 °C (морозильник)
  pack(r, 104858, (uint32_t)lround(32.0 / 200.0 * 1048576.0), 0x18);
  assert(aht20::decode(r, t, h) == aht20::OK && std::fabs(t + 18.0f) < 0.01f);
  // испорченный ответ, занятый модуль, нет калибровки
  pack(r, 524288, 300000, 0x18); r[6] ^= 1; assert(aht20::decode(r, t, h) == aht20::BAD_CRC);
  pack(r, 524288, 300000, 0x98); assert(aht20::decode(r, t, h) == aht20::BUSY);
  pack(r, 524288, 300000, 0x10); assert(aht20::decode(r, t, h) == aht20::NOT_CALIBRATED);
  // медиана отбрасывает выброс
  assert(aht20::median3(4.1f, 25.0f, 4.2f) == 4.2f && aht20::median3(3.0f, 1.0f, 2.0f) == 2.0f);
  std::puts("OK: расчёт AHT20 — температура, влажность, CRC, медиана");
  return 0;
}
