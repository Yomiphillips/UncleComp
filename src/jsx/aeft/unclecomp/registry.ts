/**
 * UncleComp Engine — project registry storage (ARCHITECTURE.md §5.3).
 *
 * The per-project registry lives inside the .aep itself, in the project's XMP
 * metadata packet (`app.project.xmpPacket`), as one JSON-valued property. The
 * engine only gets/sets the raw string — parsing and merge logic stay in the
 * Core Service, keeping this layer a stateless command surface.
 *
 * The property sits in Adobe's Dynamic Media namespace (xmpDM) rather than a
 * custom one. That is deliberate, not sloppy: xmpDM is a standard namespace
 * pre-registered in every XMP toolkit — including the one inside After Effects.
 * A custom namespace is only registered in *our* script session; AE's own
 * (separate) XMP registry has never heard of it, so the next time AE itself
 * touches the packet — the user's Ctrl+S, the packaging Save-As — it throws
 * "XMP Exception: Unregistered schema namespace URI" and the save dies mid-way
 * (which is also what tripped the "undo group mismatch" dialog: the throw
 * happened inside publish's undo group). XMP is open-world, so an extra
 * property in xmpDM is legal and ignored by other tools.
 *
 * Persistence rides the project's own save: the packet is part of the project,
 * so registry state can never be newer than the .aep it describes, and nothing
 * is left lying around next to the file.
 */

import { EngineResult } from "../../../shared/unclecomp-types";

/** Standard Dynamic Media namespace — what AE itself writes project XMP under. */
var XMPDM_NS = "http://ns.adobe.com/xmp/1.0/DynamicMedia/";
var REGISTRY_PROP = "UncleCompRegistry";

/** The custom namespace an earlier build used — see healLegacyNamespace. */
var LEGACY_NS = "https://unclecomp.dev/xmp/1.0/";
var LEGACY_PROP = "registry";

/** Load the XMP scripting library once per session; false when unavailable. */
var xmpReady = function (): boolean {
  try {
    if (ExternalObject.AdobeXMPScript === undefined) {
      ExternalObject.AdobeXMPScript = new ExternalObject("lib:AdobeXMPScript");
    }
    return typeof XMPMeta !== "undefined";
  } catch (e) {
    return false;
  }
};

/** A brand-new project can report an empty packet — start a fresh one then. */
var currentMeta = function (): XMPMetaInstance {
  var packet = "";
  try {
    packet = app.project.xmpPacket;
  } catch (e) {
    packet = "";
  }
  return packet ? new XMPMeta!(packet) : new XMPMeta!();
};

/**
 * The registry data the earlier build wrote under its custom namespace, or "".
 * Registration is per-session and only makes the *scripting* toolkit able to
 * address the URI — it does nothing for AE's internal one, which is the bug.
 */
var readLegacyProp = function (xmp: XMPMetaInstance): string {
  try {
    (XMPMeta as any).registerNamespace(LEGACY_NS, "unclecomp");
    if (!xmp.doesPropertyExist(LEGACY_NS, LEGACY_PROP)) return "";
    return xmp.getProperty(LEGACY_NS, LEGACY_PROP).value;
  } catch (e) {
    return "";
  }
};

/**
 * A project the earlier build touched carries the custom-namespace property and
 * fails EVERY subsequent AE-internal XMP serialization — including the user's
 * own Ctrl+S — until the property is gone. So finding one is treated as a wound
 * to close immediately, not data to preserve in place: its value moves to the
 * xmpDM property and the custom namespace leaves the packet. Returns the
 * registry JSON that should be live after healing.
 */
var healLegacyNamespace = function (xmp: XMPMetaInstance): string {
  var legacy = readLegacyProp(xmp);
  if (!legacy) return "";
  try {
    xmp.deleteProperty(LEGACY_NS, LEGACY_PROP);
    xmp.setProperty(XMPDM_NS, REGISTRY_PROP, legacy);
    app.project.xmpPacket = xmp.serialize();
  } catch (e) {
    /* healing failed — the value is still returned so the caller can use it */
  }
  return legacy;
};

/**
 * The registry JSON stored in the open project's XMP, or "" when absent.
 * Finding legacy custom-namespace data rewrites the packet (see above) — a
 * mutation in a read, accepted because a poisoned packet breaks saving at all.
 */
export const readRegistryXmp = (): string => {
  if (!xmpReady() || !XMPMeta) return "";
  try {
    var xmp = currentMeta();
    if (xmp.doesPropertyExist(XMPDM_NS, REGISTRY_PROP)) {
      return xmp.getProperty(XMPDM_NS, REGISTRY_PROP).value;
    }
    return healLegacyNamespace(xmp);
  } catch (e) {
    return "";
  }
};

/**
 * Store the registry JSON in the open project's XMP packet. Marks the project
 * modified — it persists when the user saves, exactly like the comment tags.
 */
export const writeRegistryXmp = (json: string): EngineResult => {
  if (!xmpReady() || !XMPMeta) {
    return { ok: false, error: "XMP scripting library unavailable." };
  }
  try {
    var xmp = currentMeta();
    // Belt-and-braces: a poisoned packet must never survive a write, even if
    // the value in it is about to be replaced anyway.
    try {
      (XMPMeta as any).registerNamespace(LEGACY_NS, "unclecomp");
      xmp.deleteProperty(LEGACY_NS, LEGACY_PROP);
    } catch (e) {
      /* nothing to scrub */
    }
    xmp.setProperty(XMPDM_NS, REGISTRY_PROP, json);
    app.project.xmpPacket = xmp.serialize();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as any).toString() };
  }
};
