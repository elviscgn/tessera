#![allow(clippy::missing_const_for_fn)]

//! Integer placement coordinates used by the native kernel.

/// A signed grid position with an integer elevation in millimetres.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct GridPosition {
    /// East/west cell coordinate.
    pub x: i32,
    /// North/south cell coordinate.
    pub z: i32,
    /// Elevation above the scenario datum, in millimetres.
    pub elevation_mm: i32,
}

impl GridPosition {
    /// Creates an integer grid position.
    pub const fn new(x: i32, z: i32, elevation_mm: i32) -> Self {
        Self { x, z, elevation_mm }
    }
}

/// One of the four canonical clockwise quarter-turns.
#[repr(u8)]
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub enum QuarterTurn {
    /// No rotation.
    #[default]
    R0 = 0,
    /// One clockwise quarter-turn.
    R1 = 1,
    /// Two clockwise quarter-turns.
    R2 = 2,
    /// Three clockwise quarter-turns.
    R3 = 3,
}

impl QuarterTurn {
    /// Converts any low two-bit value into its canonical quarter-turn.
    pub const fn from_index(value: u8) -> Self {
        match value & 3 {
            0 => Self::R0,
            1 => Self::R1,
            2 => Self::R2,
            _ => Self::R3,
        }
    }

    /// Returns the stable wire/hash representation.
    pub const fn as_u8(self) -> u8 {
        self as u8
    }
}
