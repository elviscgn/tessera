//! Deterministic arena geometry: the playing field, discs, walls, and pockets.

use crate::fixed::{Fixed, Vec2};

/// A deterministic arena definition. All dimensions are micrometres.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ArenaLayout {
    /// Field width along x (micrometres).
    pub width_micrometres: i64,
    /// Field depth along z (micrometres).
    pub depth_micrometres: i64,
    /// Wall thickness (micrometres) — discs rest against its inner face.
    pub wall_thickness_micros: i64,
    /// Radius of the goal pockets (micrometres). Pockets sit centered on the
    /// east/west walls.
    pub pocket_radius_micros: i64,
}

/// Errors from invalid arena definitions.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ArenaGeometryError {
    /// A dimension must be positive.
    NonPositiveDimension,
    /// The field must be at least twice as large as the wall thickness.
    FieldTooSmall,
    /// The pocket radius must be smaller than the half-depth.
    PocketTooLarge,
}

impl ArenaLayout {
    /// The canonical arena used by the milestone-16 contract tests.
    /// A 2440x1220 mm table (8x4 foot hockey format): field 2300 x 1200 mm.
    pub const fn standard() -> Self {
        Self {
            width_micrometres: 2_300_000,
            depth_micrometres: 1_200_000,
            wall_thickness_micros: 30_000,
            pocket_radius_micros: 110_000,
        }
    }

    /// The half-size field used for the dense-collision deterministic tests.
    pub const fn test_small() -> Self {
        Self {
            width_micrometres: 1_000_000,
            depth_micrometres: 600_000,
            wall_thickness_micros: 30_000,
            pocket_radius_micros: 110_000,
        }
    }

    /// Validates the layout; returns `Ok` only when discs can legally rest
    /// inside every wall and pockets fit inside the field.
    pub const fn validate(self) -> Result<(), ArenaGeometryError> {
        if self.width_micrometres <= 0 || self.depth_micrometres <= 0 {
            return Err(ArenaGeometryError::NonPositiveDimension);
        }
        let small_side = if self.width_micrometres < self.depth_micrometres {
            self.width_micrometres
        } else {
            self.depth_micrometres
        };
        if self.wall_thickness_micros * 2 >= small_side {
            return Err(ArenaGeometryError::FieldTooSmall);
        }
        if self.pocket_radius_micros * 2 >= self.depth_micrometres {
            return Err(ArenaGeometryError::PocketTooLarge);
        }
        Ok(())
    }

    /// The west wall x coordinate (inside face).
    pub const fn west_wall_x(self) -> i64 {
        -self.width_micrometres / 2
    }

    /// The east wall x coordinate (inside face).
    pub const fn east_wall_x(self) -> i64 {
        self.width_micrometres / 2
    }

    /// The north wall z coordinate (inside face).
    pub const fn north_wall_z(self) -> i64 {
        -self.depth_micrometres / 2
    }

    /// The south wall z coordinate (inside face).
    pub const fn south_wall_z(self) -> i64 {
        self.depth_micrometres / 2
    }

    /// The x-bounded centre interval a disc can occupy without penetrating
    /// the western wall (radius is accounted for by the caller).
    pub fn min_centre_x(self, radius_micros: i64) -> i64 {
        self.west_wall_x() + self.wall_thickness_micros + radius_micros
    }

    /// The maximum x coordinate a disc centre can occupy.
    pub fn max_centre_x(self, radius_micros: i64) -> i64 {
        self.east_wall_x() - self.wall_thickness_micros - radius_micros
    }

    /// The minimum z coordinate a disc centre can occupy.
    pub fn min_centre_z(self, radius_micros: i64) -> i64 {
        self.north_wall_z() + self.wall_thickness_micros + radius_micros
    }

    /// The maximum z coordinate a disc centre can occupy.
    pub fn max_centre_z(self, radius_micros: i64) -> i64 {
        self.south_wall_z() - self.wall_thickness_micros - radius_micros
    }

    /// The west pocket centre.
    pub const fn west_pocket_centre(self) -> (i64, i64) {
        (self.west_wall_x(), 0)
    }

    /// The east pocket centre.
    pub const fn east_pocket_centre(self) -> (i64, i64) {
        (self.east_wall_x(), 0)
    }

    /// The centre of the field.
    pub const fn centre(self) -> Vec2 {
        Vec2::from_micro(0, 0)
    }
}

/// A disc (circle) in the arena plane.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Disc {
    /// Centre on the playfield.
    pub centre: Vec2,
    /// Radius in micrometres.
    pub radius_micros: i64,
}

impl Disc {
    /// Creates a disc.
    pub const fn new(centre: Vec2, radius_micros: i64) -> Self {
        Self {
            centre,
            radius_micros,
        }
    }

    /// Whether `self` and `other` overlap (strictly less than the summed
    /// squared radius, so touching is not overlap).
    pub fn overlaps(self, other: Self) -> bool {
        let delta = self.centre - other.centre;
        let radius_sum = Fixed::from_micro(self.radius_micros + other.radius_micros);
        delta.length_squared() < radius_sum.saturating_mul(radius_sum)
    }

    /// The origin-to-contact normal (unit-length) when the two discs overlap.
    /// Returns `None` for coincident centres, which the caller must resolve
    /// deterministically.
    pub fn contact_normal_from(self, other: Self) -> Option<Vec2> {
        self.centre.direction_to(other.centre)
    }
}

#[cfg(test)]
mod tests {
    use super::{ArenaGeometryError, ArenaLayout, Disc};
    use crate::fixed::Vec2;

    #[test]
    fn direction_to_returns_unit_vectors() {
        let origin = Vec2::from_micro(0, 0);
        let east = Vec2::from_micro(500_000, 0);
        assert_eq!(origin.direction_to(east).unwrap().x.to_micro_floor(), 1);

        let north = Vec2::from_micro(0, -700_000);
        assert_eq!(origin.direction_to(north).unwrap().z.to_micro_floor(), -1);

        let missing = Vec2::from_micro(0, 0);
        assert!(origin.direction_to(missing).is_none());
    }

    #[test]
    fn arena_layout_bounds_are_exact() {
        let arena = ArenaLayout::test_small();
        assert_eq!(arena.west_wall_x(), -500_000);
        assert_eq!(arena.east_wall_x(), 500_000);
        assert_eq!(arena.north_wall_z(), -300_000);
        assert_eq!(arena.south_wall_z(), 300_000);
        assert_eq!(arena.min_centre_x(25_000), -500_000 + 30_000 + 25_000);
        assert_eq!(arena.max_centre_x(25_000), 500_000 - 30_000 - 25_000);
        assert_eq!(arena.min_centre_z(25_000), -300_000 + 30_000 + 25_000);
        assert_eq!(arena.max_centre_z(25_000), 300_000 - 30_000 - 25_000);
        assert_eq!(arena.west_pocket_centre(), (-500_000, 0));
        assert_eq!(arena.east_pocket_centre(), (500_000, 0));
    }

    #[test]
    fn arena_layout_validation() {
        let zero = ArenaLayout {
            width_micrometres: 0,
            depth_micrometres: 1_000_000,
            wall_thickness_micros: 10_000,
            pocket_radius_micros: 5_000,
        };
        assert_eq!(
            zero.validate(),
            Err(ArenaGeometryError::NonPositiveDimension)
        );
        let tiny = ArenaLayout {
            width_micrometres: 100_000,
            depth_micrometres: 100_000,
            wall_thickness_micros: 60_000,
            pocket_radius_micros: 5_000,
        };
        assert_eq!(tiny.validate(), Err(ArenaGeometryError::FieldTooSmall));
        let huge_pocket = ArenaLayout {
            width_micrometres: 1_000_000,
            depth_micrometres: 600_000,
            wall_thickness_micros: 30_000,
            pocket_radius_micros: 400_000,
        };
        assert_eq!(
            huge_pocket.validate(),
            Err(ArenaGeometryError::PocketTooLarge)
        );
        assert!(ArenaLayout::standard().validate().is_ok());
    }

    #[test]
    fn discs_overlap_and_report_contact_normals() {
        let first = Disc::new(Vec2::from_micro(0, 0), 100_000);
        let second = Disc::new(Vec2::from_micro(50_000, 0), 100_000);
        assert!(first.overlaps(second));
        let normal = first.contact_normal_from(second).expect("contact");
        assert_eq!(normal.x.to_micro_floor(), 1);
        assert_eq!(normal.z.to_micro_floor(), 0);

        let touching = Disc::new(Vec2::from_micro(200_000, 0), 100_000);
        assert!(!first.overlaps(touching));

        let far = Disc::new(Vec2::from_micro(300_000, 0), 100_000);
        assert!(!first.overlaps(far));
        // A contact normal still exists when centres differ; overlap is the
        // caller's check.
        assert_eq!(
            first.contact_normal_from(far).unwrap().x.to_micro_floor(),
            1
        );
    }

    #[test]
    fn coincident_centres_degrade_to_no_contact_normal() {
        let first = Disc::new(Vec2::from_micro(0, 0), 100_000);
        let same = Disc::new(Vec2::from_micro(0, 0), 100_000);
        assert!(first.overlaps(same));
        assert!(first.contact_normal_from(same).is_none());
    }
}
