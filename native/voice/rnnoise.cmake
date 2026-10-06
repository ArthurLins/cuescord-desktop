# Full upstream model; source and model archives are independently verified.
# No model download, file I/O or dynamic model loading at application runtime.
FetchContent_Declare(rnnoise
  URL https://codeload.github.com/xiph/rnnoise/tar.gz/70f1d256acd4b34a572f999a05c87bf00b67730d
  URL_HASH SHA256=f61ee0b3f4c4cd337303e003d333357c5eaf25ef5d75a742109ee59e9a0a3932
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_Declare(rnnoise_model
  URL https://media.xiph.org/rnnoise/models/rnnoise_data-0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37.tar.gz
  URL_HASH SHA256=0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(rnnoise rnnoise_model)
file(READ "${rnnoise_SOURCE_DIR}/model_version" rnnoise_model_version)
string(STRIP "${rnnoise_model_version}" rnnoise_model_version)
if(NOT rnnoise_model_version STREQUAL "0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37")
  message(FATAL_ERROR "RNNoise source/model mismatch")
endif()
add_library(CuescordNoise STATIC
  ${rnnoise_SOURCE_DIR}/src/denoise.c
  ${rnnoise_SOURCE_DIR}/src/rnn.c
  ${rnnoise_SOURCE_DIR}/src/pitch.c
  ${rnnoise_SOURCE_DIR}/src/kiss_fft.c
  ${rnnoise_SOURCE_DIR}/src/celt_lpc.c
  ${rnnoise_SOURCE_DIR}/src/nnet.c
  ${rnnoise_SOURCE_DIR}/src/nnet_default.c
  ${rnnoise_SOURCE_DIR}/src/parse_lpcnet_weights.c
  ${rnnoise_SOURCE_DIR}/src/rnnoise_tables.c
  ${rnnoise_model_SOURCE_DIR}/src/rnnoise_data.c)
set_target_properties(CuescordNoise PROPERTIES C_STANDARD 99 C_STANDARD_REQUIRED ON)
target_include_directories(CuescordNoise PUBLIC ${rnnoise_SOURCE_DIR}/include
  PRIVATE ${rnnoise_SOURCE_DIR}/src ${rnnoise_model_SOURCE_DIR}/src)
target_compile_definitions(CuescordNoise PRIVATE RNNOISE_BUILD)
# Keep the baseline free of AVX instructions. Dispatch only after CPU *and OS*
# support checks, including XCR0: a VM may expose AVX2 without OS AVX state.
if(CMAKE_SYSTEM_PROCESSOR MATCHES "AMD64|amd64|x86_64" OR CMAKE_GENERATOR_PLATFORM STREQUAL "x64")
  target_sources(CuescordNoise PRIVATE cpp/noise_cpu.c
    ${rnnoise_SOURCE_DIR}/src/x86/x86_dnn_map.c
    ${rnnoise_SOURCE_DIR}/src/x86/nnet_sse4_1.c
    ${rnnoise_SOURCE_DIR}/src/x86/nnet_avx2.c)
  target_compile_definitions(CuescordNoise PRIVATE RNN_ENABLE_X86_RTCD)
  if(MSVC)
    set_source_files_properties(${rnnoise_SOURCE_DIR}/src/x86/nnet_sse4_1.c
      PROPERTIES COMPILE_DEFINITIONS __SSE4_1__)
    set_source_files_properties(${rnnoise_SOURCE_DIR}/src/x86/nnet_avx2.c
      PROPERTIES COMPILE_OPTIONS /arch:AVX2)
  else()
    set_source_files_properties(${rnnoise_SOURCE_DIR}/src/x86/nnet_sse4_1.c
      PROPERTIES COMPILE_OPTIONS -msse4.1)
    set_source_files_properties(${rnnoise_SOURCE_DIR}/src/x86/nnet_avx2.c
      PROPERTIES COMPILE_OPTIONS "-mavx2;-mfma")
  endif()
endif()
if(NOT MSVC)
  target_link_libraries(CuescordNoise PRIVATE m)
endif()
