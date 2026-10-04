import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

// Binary stdout: UInt32 LE length, UInt8 type, payload. Never write source names or PCM to logs.
final class PacketWriter {
  private let lock = NSLock()
  func send(_ type: UInt8, _ payload: Data = Data()) {
    lock.lock()
    defer { lock.unlock() }
    var size = UInt32(payload.count + 1).littleEndian
    var packet = withUnsafeBytes(of: &size) { Data($0) }
    packet.append(type)
    packet.append(payload)
    FileHandle.standardOutput.write(packet)
  }
}

final class PCMConverter {
  private var converter: AVAudioConverter?
  private var inputFormat: AVAudioFormat?
  private let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48000,
                                          channels: 2, interleaved: true)!

  func convert(_ input: AVAudioPCMBuffer) throws -> Data {
    if inputFormat != input.format {
      guard let next = AVAudioConverter(from: input.format, to: outputFormat) else {
        throw CaptureFailure.format
      }
      converter = next
      inputFormat = input.format
    }
    let frames = AVAudioFrameCount(ceil(Double(input.frameLength) * 48000 / input.format.sampleRate)) + 64
    guard frames <= 48000, let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: frames) else {
      throw CaptureFailure.format
    }
    var supplied = false
    var error: NSError?
    let status = converter!.convert(to: output, error: &error) { _, state in
      if supplied { state.pointee = .noDataNow; return nil }
      supplied = true
      state.pointee = .haveData
      return input
    }
    if status == .error || error != nil { throw CaptureFailure.format }
    guard let bytes = output.audioBufferList.pointee.mBuffers.mData else { return Data() }
    return Data(bytes: bytes, count: Int(output.frameLength) * 4)
  }

  func convert(_ sample: CMSampleBuffer) throws -> Data {
    guard sample.isValid, let description = sample.formatDescription else { return Data() }
    let format = AVAudioFormat(cmAudioFormatDescription: description)
    guard format.channelCount > 0, format.channelCount <= 8, sample.numSamples > 0,
          sample.numSamples <= 48000 else { throw CaptureFailure.format }
    var size = 0
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample, bufferListSizeNeededOut: &size,
      bufferListOut: nil, bufferListSize: 0, blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: nil)
    guard size > 0, size <= 4096 else { throw CaptureFailure.format }
    let memory = UnsafeMutableRawPointer.allocate(byteCount: size, alignment: 16)
    defer { memory.deallocate() }
    let list = memory.bindMemory(to: AudioBufferList.self, capacity: 1)
    var retained: CMBlockBuffer?
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sample,
      bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: size,
      blockBufferAllocator: nil, blockBufferMemoryAllocator: nil,
      flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment), blockBufferOut: &retained)
    guard status == noErr,
          let input = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: UnsafePointer(list), deallocator: nil)
          else { throw CaptureFailure.format }
    input.frameLength = AVAudioFrameCount(sample.numSamples)
    return try withExtendedLifetime(retained) { try convert(input) }
  }
}

enum CaptureFailure: UInt8, Error { case source = 1, permission = 2, ownApplication = 3, format = 4, stopped = 5 }

struct Selection {
  let kind: String
  let source: UInt32
  let owner: Int32
  let display: UInt32?
  init(_ args: [String]) throws {
    guard args.count == 5, ["window", "screen"].contains(args[0]),
          let owner = Int32(args[2]), owner > 1 else { throw CaptureFailure.source }
    let parts = args[1].split(separator: ":", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0] == args[0], let source = UInt32(parts[1]),
          UInt32(parts[2]) != nil, args[4] == "net.cuesc.cuescord" else { throw CaptureFailure.source }
    kind = args[0]; self.source = source; self.owner = owner
    display = UInt32(args[3])
    if kind == "window" && source == 0 { throw CaptureFailure.source }
    if kind == "screen" && (display ?? source) == 0 { throw CaptureFailure.source }
  }
  func excludes(pid: Int32, bundle: String) -> Bool {
    cuescord_process_belongs_to(pid, owner) || bundle == "net.cuesc.cuescord" ||
      bundle.hasPrefix("net.cuesc.cuescord.")
  }
}

@available(macOS 13.0, *)
final class AudioCapture: NSObject, SCStreamOutput, SCStreamDelegate {
  let writer = PacketWriter()
  private let converter = PCMConverter()
  private var stream: SCStream?
  private let queue = DispatchQueue(label: "net.cuesc.cuescord.screen-audio")

  func start(_ selection: Selection) async throws {
    let content: SCShareableContent
    do { content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false) }
    catch { throw CaptureFailure.permission }
    let filter: SCContentFilter
    if selection.kind == "window" {
      guard let window = content.windows.first(where: { $0.windowID == selection.source }),
            let application = window.owningApplication, let display = content.displays.first else {
        throw CaptureFailure.source
      }
      guard !selection.excludes(pid: application.processID, bundle: application.bundleIdentifier) else {
        throw CaptureFailure.ownApplication
      }
      // Audio belongs to the selected application's process, not to other windows/apps.
      filter = SCContentFilter(display: display, including: [application], exceptingWindows: [])
    } else {
      guard let display = content.displays.first(where: { $0.displayID == (selection.display ?? selection.source) }) else {
        throw CaptureFailure.source
      }
      let excluded = content.applications.filter {
        selection.excludes(pid: $0.processID, bundle: $0.bundleIdentifier)
      }
      filter = SCContentFilter(display: display, excludingApplications: excluded, exceptingWindows: [])
    }
    let configuration = SCStreamConfiguration()
    configuration.width = 2; configuration.height = 2
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 1)
    configuration.capturesAudio = true
    configuration.sampleRate = 48000; configuration.channelCount = 2
    configuration.excludesCurrentProcessAudio = true
    let capture = SCStream(filter: filter, configuration: configuration, delegate: self)
    try capture.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
    stream = capture
    do { try await capture.startCapture() } catch { throw CaptureFailure.permission }
    writer.send(0)
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
    guard type == .audio else { return }
    do {
      let pcm = try converter.convert(sample)
      for offset in stride(from: 0, to: pcm.count, by: 8192) {
        writer.send(1, pcm.subdata(in: offset..<min(offset + 8192, pcm.count)))
      }
    } catch { writer.send(2, Data([CaptureFailure.format.rawValue])); exit(1) }
  }
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    writer.send(2, Data([CaptureFailure.stopped.rawValue])); exit(1)
  }
  func stop() async { try? await stream?.stopCapture(); exit(0) }
}

func selfTest() throws {
  let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 2, interleaved: false)!
  let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
  input.frameLength = 4096
  for index in 0..<4096 {
    input.floatChannelData![0][index] = Float(sin(Double(index) * 2 * .pi * 440 / 48000) * 0.002)
    input.floatChannelData![1][index] = Float(sin(Double(index) * 2 * .pi * 997 / 48000) * 0.25)
  }
  let pcm = try PCMConverter().convert(input)
  guard pcm.count == 4096 * 4 else { throw CaptureFailure.format }
  for index in 0..<4096 {
    for channel in 0..<2 {
      let offset = index * 4 + channel * 2
      let value = Int16(bitPattern: UInt16(pcm[offset]) | UInt16(pcm[offset + 1]) << 8)
      let expected = Double(input.floatChannelData![channel][index]) * 32768
      guard abs(Double(value) - expected) <= 2 else { throw CaptureFailure.format }
    }
  }
  let selection = try Selection(["window", "window:7:0", String(getppid()), "", "net.cuesc.cuescord"])
  guard selection.excludes(pid: getpid(), bundle: "other"),
        selection.excludes(pid: 999999, bundle: "net.cuesc.cuescord.helper"),
        !selection.excludes(pid: 999999, bundle: "other") else { throw CaptureFailure.source }
  FileHandle.standardOutput.write(Data("{\"stereoPCM\":true,\"quietAudioPreserved\":true,\"ownProcessExcluded\":true}\n".utf8))
}

@main struct ScreenAudioMain {
  static func main() async {
    signal(SIGPIPE, SIG_IGN)
    do {
      let arguments = Array(CommandLine.arguments.dropFirst())
      if arguments == ["--self-test"] { try selfTest(); return }
      guard arguments.first == "--capture" else { throw CaptureFailure.source }
      let selection = try Selection(Array(arguments.dropFirst()))
      if #available(macOS 13.0, *) {
        let capture = AudioCapture()
        // EOF or an explicit stop revokes capture; no background recording after the parent exits.
        DispatchQueue.global().async {
          _ = FileHandle.standardInput.availableData
          Task { await capture.stop() }
        }
        try await capture.start(selection)
        while true { try await Task.sleep(nanoseconds: 5_000_000_000) }
      } else { throw CaptureFailure.source }
    } catch {
      PacketWriter().send(2, Data([(error as? CaptureFailure ?? .stopped).rawValue]))
      exit(1)
    }
  }
}
