# Small compatibility patch against the hash-pinned upstream revision. Native
# voice advertises audio only and accepts the same RTCIceServer objects as JS,
# including TURN credentials and multiple URLs during credential renewal.
file(READ "${ROOT}/src/Handler.cpp" source)
string(REPLACE "\r\n" "\n" source "${source}")
set(video "\t\t(void)pc->AddTransceiver(webrtc::MediaType::VIDEO);")
string(FIND "${source}" "${video}" videoPosition)
if(videoPosition LESS 0)
  string(FIND "${source}" "Cuescord: voice-only capabilities; no video transceiver." patchedVideo)
  if(patchedVideo LESS 0)
    message(FATAL_ERROR "Pinned libmediasoupclient audio-only patch context changed")
  endif()
else()
  string(REPLACE "${video}" "\t\t// Cuescord: voice-only capabilities; no video transceiver." source "${source}")
endif()
set(original [=[
			iceServer.uri = iceServerUri.get<std::string>();
			configuration.servers.push_back(iceServer);
]=])
set(replacement [=[
			// Cuescord RTCIceServer contract v1.
			if (iceServerUri.is_string()) iceServer.urls.push_back(iceServerUri.get<std::string>());
			else {
				const auto& urls = iceServerUri.at("urls");
				if (urls.is_string()) iceServer.urls.push_back(urls.get<std::string>());
				else iceServer.urls = urls.get<std::vector<std::string>>();
				iceServer.username = iceServerUri.value("username", std::string{});
				iceServer.password = iceServerUri.value("credential", std::string{});
			}
			configuration.servers.push_back(std::move(iceServer));
]=])
string(FIND "${source}" "${original}" position)
if(position LESS 0)
  string(FIND "${source}" "Cuescord RTCIceServer contract v1." patched)
  if(patched LESS 0)
    message(FATAL_ERROR "Pinned libmediasoupclient ICE patch context changed")
  endif()
else()
  string(REPLACE "${original}" "${replacement}" source "${source}")
endif()
file(WRITE "${ROOT}/src/Handler.cpp" "${source}")
