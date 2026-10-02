package com.tvdavovo.inicio;

/**
 * Descricoes de servico (SCPD) do receptor. Os apps do celular leem isto para
 * saber quais comandos a TV aceita; sem elas varios nem listam a TV.
 *
 * Cada acao: "Nome|arg:in|out:VariavelRelacionada,...".
 * Cada variavel: "Nome:tipo" com "!" no fim quando manda evento.
 */
final class Scpd {

    private Scpd() {}

    static final String AVT = montar(new String[] {
        "SetAVTransportURI|InstanceID:in:A_ARG_TYPE_InstanceID,CurrentURI:in:AVTransportURI,CurrentURIMetaData:in:AVTransportURIMetaData",
        "SetNextAVTransportURI|InstanceID:in:A_ARG_TYPE_InstanceID,NextURI:in:NextAVTransportURI,NextURIMetaData:in:NextAVTransportURIMetaData",
        "GetMediaInfo|InstanceID:in:A_ARG_TYPE_InstanceID,NrTracks:out:NumberOfTracks,MediaDuration:out:CurrentMediaDuration,"
            + "CurrentURI:out:AVTransportURI,CurrentURIMetaData:out:AVTransportURIMetaData,NextURI:out:NextAVTransportURI,"
            + "NextURIMetaData:out:NextAVTransportURIMetaData,PlayMedium:out:PlaybackStorageMedium,"
            + "RecordMedium:out:RecordStorageMedium,WriteStatus:out:RecordMediumWriteStatus",
        "GetTransportInfo|InstanceID:in:A_ARG_TYPE_InstanceID,CurrentTransportState:out:TransportState,"
            + "CurrentTransportStatus:out:TransportStatus,CurrentSpeed:out:TransportPlaySpeed",
        "GetPositionInfo|InstanceID:in:A_ARG_TYPE_InstanceID,Track:out:CurrentTrack,TrackDuration:out:CurrentTrackDuration,"
            + "TrackMetaData:out:CurrentTrackMetaData,TrackURI:out:CurrentTrackURI,RelTime:out:RelativeTimePosition,"
            + "AbsTime:out:AbsoluteTimePosition,RelCount:out:RelativeCounterPosition,AbsCount:out:AbsoluteCounterPosition",
        "GetDeviceCapabilities|InstanceID:in:A_ARG_TYPE_InstanceID,PlayMedia:out:PossiblePlaybackStorageMedia,"
            + "RecMedia:out:PossibleRecordStorageMedia,RecQualityModes:out:PossibleRecordQualityModes",
        "GetTransportSettings|InstanceID:in:A_ARG_TYPE_InstanceID,PlayMode:out:CurrentPlayMode,RecQualityMode:out:CurrentRecordQualityMode",
        "GetCurrentTransportActions|InstanceID:in:A_ARG_TYPE_InstanceID,Actions:out:CurrentTransportActions",
        "Stop|InstanceID:in:A_ARG_TYPE_InstanceID",
        "Play|InstanceID:in:A_ARG_TYPE_InstanceID,Speed:in:TransportPlaySpeed",
        "Pause|InstanceID:in:A_ARG_TYPE_InstanceID",
        "Seek|InstanceID:in:A_ARG_TYPE_InstanceID,Unit:in:A_ARG_TYPE_SeekMode,Target:in:A_ARG_TYPE_SeekTarget",
        "Next|InstanceID:in:A_ARG_TYPE_InstanceID",
        "Previous|InstanceID:in:A_ARG_TYPE_InstanceID",
        "SetPlayMode|InstanceID:in:A_ARG_TYPE_InstanceID,NewPlayMode:in:CurrentPlayMode",
    }, new String[] {
        "TransportState:string", "TransportStatus:string", "PlaybackStorageMedium:string",
        "RecordStorageMedium:string", "PossiblePlaybackStorageMedia:string", "PossibleRecordStorageMedia:string",
        "CurrentPlayMode:string", "TransportPlaySpeed:string", "RecordMediumWriteStatus:string",
        "CurrentRecordQualityMode:string", "PossibleRecordQualityModes:string", "NumberOfTracks:ui4",
        "CurrentTrack:ui4", "CurrentTrackDuration:string", "CurrentMediaDuration:string",
        "CurrentTrackMetaData:string", "CurrentTrackURI:string", "AVTransportURI:string",
        "AVTransportURIMetaData:string", "NextAVTransportURI:string", "NextAVTransportURIMetaData:string",
        "RelativeTimePosition:string", "AbsoluteTimePosition:string", "RelativeCounterPosition:i4",
        "AbsoluteCounterPosition:i4", "CurrentTransportActions:string", "LastChange:string!",
        "A_ARG_TYPE_SeekMode:string", "A_ARG_TYPE_SeekTarget:string", "A_ARG_TYPE_InstanceID:ui4",
    });

    static final String RCS = montar(new String[] {
        "ListPresets|InstanceID:in:A_ARG_TYPE_InstanceID,CurrentPresetNameList:out:PresetNameList",
        "SelectPreset|InstanceID:in:A_ARG_TYPE_InstanceID,PresetName:in:A_ARG_TYPE_PresetName",
        "GetMute|InstanceID:in:A_ARG_TYPE_InstanceID,Channel:in:A_ARG_TYPE_Channel,CurrentMute:out:Mute",
        "SetMute|InstanceID:in:A_ARG_TYPE_InstanceID,Channel:in:A_ARG_TYPE_Channel,DesiredMute:in:Mute",
        "GetVolume|InstanceID:in:A_ARG_TYPE_InstanceID,Channel:in:A_ARG_TYPE_Channel,CurrentVolume:out:Volume",
        "SetVolume|InstanceID:in:A_ARG_TYPE_InstanceID,Channel:in:A_ARG_TYPE_Channel,DesiredVolume:in:Volume",
    }, new String[] {
        "PresetNameList:string", "LastChange:string!", "Mute:boolean", "Volume:ui2",
        "A_ARG_TYPE_Channel:string", "A_ARG_TYPE_InstanceID:ui4", "A_ARG_TYPE_PresetName:string",
    });

    static final String CMS = montar(new String[] {
        "GetProtocolInfo|Source:out:SourceProtocolInfo,Sink:out:SinkProtocolInfo",
        "GetCurrentConnectionIDs|ConnectionIDs:out:CurrentConnectionIDs",
        "GetCurrentConnectionInfo|ConnectionID:in:A_ARG_TYPE_ConnectionID,RcsID:out:A_ARG_TYPE_RcsID,"
            + "AVTransportID:out:A_ARG_TYPE_AVTransportID,ProtocolInfo:out:A_ARG_TYPE_ProtocolInfo,"
            + "PeerConnectionManager:out:A_ARG_TYPE_ConnectionManager,PeerConnectionID:out:A_ARG_TYPE_ConnectionID,"
            + "Direction:out:A_ARG_TYPE_Direction,Status:out:A_ARG_TYPE_ConnectionStatus",
    }, new String[] {
        "SourceProtocolInfo:string!", "SinkProtocolInfo:string!", "CurrentConnectionIDs:string!",
        "A_ARG_TYPE_ConnectionStatus:string", "A_ARG_TYPE_ConnectionManager:string",
        "A_ARG_TYPE_Direction:string", "A_ARG_TYPE_ProtocolInfo:string", "A_ARG_TYPE_ConnectionID:i4",
        "A_ARG_TYPE_AVTransportID:i4", "A_ARG_TYPE_RcsID:i4",
    });

    private static String montar(String[] acoes, String[] variaveis) {
        StringBuilder sb = new StringBuilder("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n")
            .append("<scpd xmlns=\"urn:schemas-upnp-org:service-1-0\">")
            .append("<specVersion><major>1</major><minor>0</minor></specVersion><actionList>");
        for (String a : acoes) {
            String[] p = a.split("\\|");
            sb.append("<action><name>").append(p[0]).append("</name>");
            if (p.length > 1) {
                sb.append("<argumentList>");
                for (String arg : p[1].split(",")) {
                    String[] x = arg.split(":");
                    sb.append("<argument><name>").append(x[0]).append("</name><direction>").append(x[1])
                        .append("</direction><relatedStateVariable>").append(x[2])
                        .append("</relatedStateVariable></argument>");
                }
                sb.append("</argumentList>");
            }
            sb.append("</action>");
        }
        sb.append("</actionList><serviceStateTable>");
        for (String v : variaveis) {
            boolean evento = v.endsWith("!");
            String[] x = (evento ? v.substring(0, v.length() - 1) : v).split(":");
            sb.append("<stateVariable sendEvents=\"").append(evento ? "yes" : "no").append("\"><name>")
                .append(x[0]).append("</name><dataType>").append(x[1]).append("</dataType>");
            if ("Volume".equals(x[0])) {
                sb.append("<allowedValueRange><minimum>0</minimum><maximum>100</maximum><step>1</step></allowedValueRange>");
            }
            sb.append("</stateVariable>");
        }
        return sb.append("</serviceStateTable></scpd>").toString();
    }
}
