/* MIT. RNNoise's dispatch table is 0=scalar, 1=SSE4.1, 2=AVX2/FMA. */
#ifdef _MSC_VER
#include <intrin.h>
int rnn_select_arch(void) {
  int info[4];
  __cpuid(info, 0);
  const int maximum = info[0];
  if (maximum < 1) return 0;
  __cpuidex(info, 1, 0);
  if (!(info[2] & (1 << 19))) return 0;
  const unsigned int avx = (1u << 27) | (1u << 28) | (1u << 12);
  if (((unsigned int)info[2] & avx) != avx || maximum < 7 || (_xgetbv(0) & 6) != 6) return 1;
  __cpuidex(info, 7, 0);
  return (info[1] & (1 << 5)) ? 2 : 1;
}
#else
int rnn_select_arch(void) {
  __builtin_cpu_init();
  if (!__builtin_cpu_supports("sse4.1")) return 0;
  return __builtin_cpu_supports("avx2") && __builtin_cpu_supports("fma") ? 2 : 1;
}
#endif
