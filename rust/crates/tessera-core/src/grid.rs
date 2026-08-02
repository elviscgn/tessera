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

/// Errors returned while constructing the canonical tile scale.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GridMathError {
    /// A tile cannot have zero millimetres of width.
    ZeroTileSize,
}

/// Integer millimetres-per-tile scale shared by placement and presentation.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct TileScale {
    millimetres_per_tile: u32,
}

impl TileScale {
    /// Creates a positive integer tile scale.
    pub const fn new(millimetres_per_tile: u32) -> Result<Self, GridMathError> {
        if millimetres_per_tile == 0 {
            Err(GridMathError::ZeroTileSize)
        } else {
            Ok(Self {
                millimetres_per_tile,
            })
        }
    }

    /// Returns the configured integer tile width.
    pub const fn millimetres_per_tile(self) -> u32 {
        self.millimetres_per_tile
    }

    /// Returns the inclusive lower world boundary of a cell in millimetres.
    pub fn cell_origin_mm(self, cell: i32) -> i64 {
        i64::from(cell) * i64::from(self.millimetres_per_tile)
    }

    /// Returns the visual centre of a cell. A half-millimetre is representable.
    pub fn cell_center_mm(self, cell: i32) -> f64 {
        self.cell_origin_mm(cell) as f64 + f64::from(self.millimetres_per_tile) / 2.0
    }

    /// Applies floor division so negative boundaries map to the lower cell.
    pub fn world_to_cell(self, world_mm: i64) -> Option<i32> {
        i32::try_from(world_mm.div_euclid(i64::from(self.millimetres_per_tile))).ok()
    }
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

    /// Rotates a footprint offset clockwise in the canonical grid basis.
    pub const fn rotate_offset(self, dx: i32, dz: i32) -> (i32, i32) {
        match self {
            Self::R0 => (dx, dz),
            Self::R1 => (-dz, dx),
            Self::R2 => (-dx, -dz),
            Self::R3 => (dz, -dx),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{GridMathError, QuarterTurn, TileScale};

    #[test]
    fn tile_scale_uses_floor_division_for_negative_boundaries() {
        assert_eq!(TileScale::new(1_000).unwrap().world_to_cell(0), Some(0));
        assert_eq!(TileScale::new(1_000).unwrap().world_to_cell(999), Some(0));
        assert_eq!(TileScale::new(1_000).unwrap().world_to_cell(1_000), Some(1));
        assert_eq!(TileScale::new(1_000).unwrap().world_to_cell(-1), Some(-1));
        assert_eq!(
            TileScale::new(1_000).unwrap().world_to_cell(-1_000),
            Some(-1)
        );
        assert_eq!(
            TileScale::new(1_000).unwrap().world_to_cell(-1_001),
            Some(-2)
        );
    }

    #[test]
    fn tile_scale_reports_centres_and_rejects_zero() {
        assert_eq!(TileScale::new(0), Err(GridMathError::ZeroTileSize));
        let scale = TileScale::new(750).unwrap();
        assert_eq!(scale.cell_origin_mm(-2), -1_500);
        assert_eq!(scale.cell_center_mm(-2), -1_125.0);
    }

    #[test]
    fn quarter_turns_follow_the_canonical_clockwise_table() {
        let offsets = [
            QuarterTurn::R0.rotate_offset(2, 3),
            QuarterTurn::R1.rotate_offset(2, 3),
            QuarterTurn::R2.rotate_offset(2, 3),
            QuarterTurn::R3.rotate_offset(2, 3),
        ];
        assert_eq!(offsets, [(2, 3), (-3, 2), (-2, -3), (3, -2)]);
    }
}
