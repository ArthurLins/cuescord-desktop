#pragma once
#include <json.hpp>

#include "audio_devices.hpp"
#include "voice_controls.hpp"

namespace cuescord {
inline nlohmann::json signalMeasurements(const SignalMetrics& metrics) {
  if (metrics.frames.load() == 0) return nlohmann::json::object();
  return {{"rmsDbfs", metrics.rmsDbfs.load()},
          {"peakDbfs", metrics.peakDbfs.load()},
          {"frames", metrics.frames.load()},
          {"silentFrames", metrics.silentFrames.load()},
          {"nearFullScaleSamples", metrics.nearFullScaleSamples.load()},
          {"nonFiniteSamples", metrics.nonFiniteSamples.load()},
          {"abruptZeroFrames", metrics.abruptZeroFrames.load()},
          {"boundaryStepPeak", metrics.boundaryStepPeak.load()}};
}
inline nlohmann::json processingMeasurements(const Controls& controls) {
  nlohmann::json result = {
      {"version", 1},
      {"captureInputStage", "post-apm"},
      {"sampleRate", controls.captureProcessingRate.load()},
      {"channels", controls.captureProcessingChannels.load()},
      {"deviceFormatErrors", controls.captureDeviceFormatErrors.load()},
      {"vadMode", 2},
      {"vadAnalysisGain", controls.activityAnalysisGain.load()},
      {"speechClassifierActive", controls.speechClassifierActive.load()},
      {"speechClassifierFallback", controls.speechClassifierFailed.load()},
      {"speechProbability", controls.speechProbability.load()},
      {"speechClassifierFrames", controls.speechClassifierFrames.load()},
      {"speechClassifierAverageMs", controls.speechClassifierFrames.load() > 0
                                        ? double(controls.speechClassifierMicros.load()) /
                                              controls.speechClassifierFrames.load() / 1000
                                        : 0},
      {"speechClassifierMaxMs", double(controls.speechClassifierMaxMicros.load()) / 1000},
      {"activityDetected", controls.activityDetected.load()},
      {"gateOpen", controls.activityGateOpen.load()},
      {"speechFrames", controls.activitySpeechFrames.load()},
      {"closedFrames", controls.activityClosedFrames.load()},
      {"gateTransitions", controls.activityTransitions.load()},
      {"noiseSpeechProbability", controls.noiseSpeechProbability.load()},
      {"noiseDryMix", controls.noiseDryMix.load()},
      {"preGainLimiterGain", controls.preGainLimiterGain.load()},
      {"limitedPreGainFrames", controls.limitedPreGainFrames.load()},
      {"limitedSourceFrames", controls.limitedSourceFrames.load()},
      {"sourceLimiterMinimumGain", controls.sourceLimiterMinimumGain.load()},
      {"signals",
       {{"captureDevice", signalMeasurements(controls.captureDevice)},
        {"captureInput", signalMeasurements(controls.captureInput)},
        {"captureProcessed", signalMeasurements(controls.captureProcessed)},
        {"captureOutput", signalMeasurements(controls.captureOutput)},
        {"renderInput", signalMeasurements(controls.renderInput)},
        {"renderOutput", signalMeasurements(controls.renderOutput)}}}};
  if (controls.captureDeviceRate.load() > 0)
    result.update({{"deviceSampleRate", controls.captureDeviceRate.load()},
                   {"deviceChannels", controls.captureDeviceChannels.load()},
                   {"deviceBytesPerFrame", controls.captureDeviceBytesPerFrame.load()}});
  if (controls.captureProcessingRate.load() == 0) {
    result.erase("sampleRate");
    result.erase("channels");
  }
  return result;
}
inline nlohmann::json endpointMeasurements(const AudioDevices::Selection& selection) {
  nlohmann::json result = {{"selection", selection.mode},
                           {"label", selection.label.substr(0, 200)},
                           {"requestedDeviceMatched", selection.requestedMatched},
                           {"inspectionError", selection.endpoint.error}};
  if (selection.endpoint.presenceAvailable) result["endpointPresent"] = selection.endpoint.present;
  if (selection.endpoint.mixRate > 0)
    result.update({{"sharedMixSampleRate", selection.endpoint.mixRate},
                   {"sharedMixChannels", selection.endpoint.mixChannels},
                   {"sharedMixBits", selection.endpoint.mixBits}});
  return result;
}
}  // namespace cuescord
