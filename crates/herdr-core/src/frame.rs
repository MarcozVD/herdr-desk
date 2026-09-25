pub const HEADER_LEN: usize = 16;
pub const FLAG_FULL: u8 = 1;
pub const FLAG_CLOSED: u8 = 2;

pub fn encode_frame(seq: u64, width: u16, height: u16, full: bool, bytes: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER_LEN + bytes.len());
    out.extend_from_slice(&seq.to_le_bytes());
    out.extend_from_slice(&width.to_le_bytes());
    out.extend_from_slice(&height.to_le_bytes());
    out.push(if full { FLAG_FULL } else { 0 });
    out.extend_from_slice(&[0u8; 3]);
    out.extend_from_slice(bytes);
    out
}

pub fn encode_closed(reason: &str) -> Vec<u8> {
    encode_frame(0, 0, 0, false, reason.as_bytes()).with_closed_flag()
}

trait WithClosedFlag {
    fn with_closed_flag(self) -> Vec<u8>;
}

impl WithClosedFlag for Vec<u8> {
    fn with_closed_flag(mut self) -> Vec<u8> {
        self[12] |= FLAG_CLOSED;
        self
    }
}

pub fn decode_header(buf: &[u8]) -> Option<(u64, u16, u16, u8)> {
    if buf.len() < HEADER_LEN {
        return None;
    }
    let seq = u64::from_le_bytes(buf[0..8].try_into().ok()?);
    let width = u16::from_le_bytes(buf[8..10].try_into().ok()?);
    let height = u16::from_le_bytes(buf[10..12].try_into().ok()?);
    Some((seq, width, height, buf[12]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_roundtrip_header() {
        let payload = b"\x1b[31mhi";
        let bytes = encode_frame(42, 80, 25, true, payload);
        assert_eq!(bytes.len(), HEADER_LEN + payload.len());
        let (seq, width, height, flags) = decode_header(&bytes).expect("header");
        assert_eq!(seq, 42);
        assert_eq!(width, 80);
        assert_eq!(height, 25);
        assert_eq!(flags & FLAG_FULL, FLAG_FULL);
        assert_eq!(flags & FLAG_CLOSED, 0);
        assert_eq!(&bytes[HEADER_LEN..], payload);
    }

    #[test]
    fn closed_frame_header() {
        let bytes = encode_closed("bridge_exit");
        let (seq, width, height, flags) = decode_header(&bytes).expect("header");
        assert_eq!(seq, 0);
        assert_eq!(width, 0);
        assert_eq!(height, 0);
        assert_eq!(flags & FLAG_CLOSED, FLAG_CLOSED);
        assert_eq!(&bytes[HEADER_LEN..], b"bridge_exit");
    }
}
