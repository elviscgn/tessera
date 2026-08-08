//! Deterministic fixed-point arithmetic for the arena engine track.
//!
//! The engine-track contract (locked in M16) uses micrometre-based signed
//! 64-bit fixed-point values with 10 fractional bits. Every arithmetic
//! operation is defined in terms of plain sign-magnitude integer math so
//! results are bit-identical across platforms, targets, and wasm builds.
//! Floating point never appears in authoritative state.

/// Fixed-point scale: one stored unit is 1/1024 micrometre (≈ 0.00098 mm).
pub const FRACTIONAL_BITS: u32 = 10;
/// The multiplier that converts a fixed-point value to micrometres.
pub const MICROMETRE_SCALE: i64 = 1 << FRACTIONAL_BITS;
/// The fixed-point representation of one micrometre.
pub const ONE_MICROMETRE: Fixed = Fixed::from_micro(1);
/// The fixed-point representation of one millimetre.
pub const ONE_MILLIMETRE: Fixed = Fixed::from_micro(1_000);

/// A deterministic signed fixed-point scalar with 10 fractional bits.
#[derive(Clone, Copy, Debug, Default, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct Fixed(i64);

impl Fixed {
    /// Creates a fixed-point value from micrometres.
    pub const fn from_micro(micros: i64) -> Self {
        Self(micros << FRACTIONAL_BITS)
    }

    /// Creates a fixed-point value from millimetres.
    pub const fn from_mm(mm: i64) -> Self {
        Self::from_micro(mm * 1000)
    }

    /// Creates from an arbitrary fixed-point representation (internal use).
    pub const fn from_raw(raw: i64) -> Self {
        Self(raw)
    }

    /// The raw fixed-point representation.
    pub const fn raw(self) -> i64 {
        self.0
    }

    /// The value truncated to whole micrometres.
    pub const fn to_micro_floor(self) -> i64 {
        self.0 / MICROMETRE_SCALE
    }

    /// The value truncated to whole millimetres.
    pub const fn to_mm_floor(self) -> i64 {
        self.to_micro_floor() / 1000
    }

    /// Zero.
    pub const fn zero() -> Self {
        Self(0)
    }

    /// One.
    pub const fn one() -> Self {
        Self(MICROMETRE_SCALE)
    }

    /// The smallest representable positive value.
    pub const fn epsilon() -> Self {
        Self(1)
    }

    /// Absolutely.
    pub const fn abs(self) -> Self {
        Self(self.0.abs())
    }

    /// Whether this value is exactly zero.
    pub const fn is_zero(self) -> bool {
        self.0 == 0
    }

    /// Whether this value is negative.
    pub const fn is_negative(self) -> bool {
        self.0 < 0
    }

    /// Saturated addition.
    pub fn checked_add(self, other: Self) -> Option<Self> {
        Some(Self(self.0.checked_add(other.0)?))
    }

    /// Saturated subtraction.
    pub fn checked_sub(self, other: Self) -> Option<Self> {
        Some(Self(self.0.checked_sub(other.0)?))
    }

    /// Multiplication with deterministic rounding down.
    pub fn checked_mul(self, other: Self) -> Option<Self> {
        Some(Self(
            self.0.checked_mul(other.0)?.checked_div(MICROMETRE_SCALE)?,
        ))
    }

    /// Division with deterministic rounding down.
    pub fn checked_div(self, divisor: Self) -> Option<Self> {
        if divisor.is_zero() {
            return None;
        }
        Some(Self(
            self.0
                .checked_mul(MICROMETRE_SCALE)?
                .checked_div(divisor.0)?,
        ))
    }

    /// Saturating addition (never panics).
    pub fn saturating_add(self, other: Self) -> Self {
        Self(self.0.saturating_add(other.0))
    }

    /// Saturating subtraction.
    pub fn saturating_sub(self, other: Self) -> Self {
        Self(self.0.saturating_sub(other.0))
    }

    /// Saturating multiplication with deterministic rounding down.
    pub fn saturating_mul(self, other: Self) -> Self {
        Self(
            self.0
                .saturating_mul(other.0)
                .saturating_div(MICROMETRE_SCALE),
        )
    }

    /// Saturating division.
    pub fn saturating_div(self, divisor: Self) -> Self {
        if divisor.is_zero() {
            return Self(if self.is_negative() {
                i64::MIN
            } else {
                i64::MAX
            });
        }
        Self(
            self.0
                .saturating_mul(MICROMETRE_SCALE)
                .saturating_div(divisor.0),
        )
    }

    /// A minimum-magnitude threshold check: `self.abs() < threshold`.
    pub fn below_abs(self, threshold: Self) -> bool {
        self.abs() < threshold.abs()
    }

    /// Saturating negation.
    pub fn saturating_neg(self) -> Self {
        Self(self.0.saturating_neg())
    }

    /// The square root of a value, deterministic on all integer sizes.
    ///
    /// The fix-point representation is `value.raw() = v * SCALE`, so the root
    /// is found on `v * SCALE^2` then returned as `root * SCALE`, keeping the
    /// result in the same scale as the input.
    pub fn sqrt(self) -> Self {
        if self.0 <= 0 {
            return Self::zero();
        }
        let target = self.0 as u128 * MICROMETRE_SCALE as u128;
        let mut left: u128 = 0;
        let mut right: u128 = target.saturating_add(1);
        while left + 1 < right {
            let middle = (left + right) / 2;
            if middle.saturating_mul(middle) <= target {
                left = middle;
            } else {
                right = middle;
            }
        }
        Self(left as i64)
    }
}

impl std::ops::Add for Fixed {
    type Output = Self;
    fn add(self, other: Self) -> Self {
        Self(self.0 + other.0)
    }
}

impl std::ops::Sub for Fixed {
    type Output = Self;
    fn sub(self, other: Self) -> Self {
        Self(self.0 - other.0)
    }
}

impl std::ops::Neg for Fixed {
    type Output = Self;
    fn neg(self) -> Self {
        Self(-self.0)
    }
}

impl std::ops::AddAssign for Fixed {
    fn add_assign(&mut self, other: Self) {
        self.0 += other.0;
    }
}

impl std::ops::SubAssign for Fixed {
    fn sub_assign(&mut self, other: Self) {
        self.0 -= other.0;
    }
}

impl std::fmt::Display for Fixed {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}.{:03}",
            self.to_micro_floor() / 1000,
            self.to_micro_floor().abs() % 1000
        )
    }
}

/// The maximum value representable by [`Fixed`].
pub const MAX: Fixed = Fixed(i64::MAX);

/// A deterministic 2D vector over [`Fixed`].
#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, PartialOrd)]
pub struct Vec2 {
    /// x coordinate.
    pub x: Fixed,
    /// z coordinate (ground-plane, y-up convention keeps z the second axis).
    pub z: Fixed,
}

impl Vec2 {
    /// The zero vector.
    pub const fn zero() -> Self {
        Self {
            x: Fixed::zero(),
            z: Fixed::zero(),
        }
    }

    /// A vector from raw micrometre coordinates.
    pub const fn from_micro(x: i64, z: i64) -> Self {
        Self {
            x: Fixed::from_micro(x),
            z: Fixed::from_micro(z),
        }
    }

    /// A vector from raw fixed-point coordinates.
    pub const fn from_raw(x: i64, z: i64) -> Self {
        Self {
            x: Fixed::from_raw(x),
            z: Fixed::from_raw(z),
        }
    }

    /// Component-wise addition.
    pub fn checked_add(self, other: Self) -> Option<Self> {
        Some(Self {
            x: self.x.checked_add(other.x)?,
            z: self.z.checked_add(other.z)?,
        })
    }

    /// Component-wise subtraction.
    pub fn checked_sub(self, other: Self) -> Option<Self> {
        Some(Self {
            x: self.x.checked_sub(other.x)?,
            z: self.z.checked_sub(other.z)?,
        })
    }

    /// Component-wise addition, saturating.
    pub fn saturating_add(self, other: Self) -> Self {
        Self {
            x: self.x.saturating_add(other.x),
            z: self.z.saturating_add(other.z),
        }
    }

    /// Component-wise subtraction, saturating.
    pub fn saturating_sub(self, other: Self) -> Self {
        Self {
            x: self.x.saturating_sub(other.x),
            z: self.z.saturating_sub(other.z),
        }
    }

    /// Scaled component-wise multiplication, saturating.
    pub fn saturating_scale(self, scalar: Fixed) -> Self {
        Self {
            x: self.x.saturating_mul(scalar),
            z: self.z.saturating_mul(scalar),
        }
    }

    /// The squared length (no square root).
    pub fn length_squared(self) -> Fixed {
        self.x.saturating_mul(self.x) + self.z.saturating_mul(self.z)
    }

    /// The length.
    pub fn length(self) -> Fixed {
        self.length_squared().sqrt()
    }

    /// The dot product, saturating.
    pub fn dot(self, other: Self) -> Fixed {
        self.x.saturating_mul(other.x) + self.z.saturating_mul(other.z)
    }

    /// Divides both components by a length so the result is a dimensionless
    /// unit-ish vector. Dividing directly loses no precision, unlike
    /// multiply-by-reciprocal.
    pub fn saturating_div_length(self, divisor: Fixed) -> Self {
        Self {
            x: self.x.saturating_div(divisor),
            z: self.z.saturating_div(divisor),
        }
    }

    /// The unit vector toward `other`, with `None` for zero-length offsets.
    pub fn direction_to(self, other: Self) -> Option<Self> {
        let delta = other - self;
        let length = delta.length();
        if length.is_zero() {
            return None;
        }
        Some(delta.saturating_div_length(length))
    }

    /// The perpendicular counter-clockwise 90-degree rotation.
    pub fn perpendicular(self) -> Self {
        Self {
            x: Fixed(self.z.0.checked_neg().expect("negation cannot fail")),
            z: self.x,
        }
    }

    /// Whether every component is zero.
    pub const fn is_zero(self) -> bool {
        self.x.is_zero() && self.z.is_zero()
    }

    /// Whether the length is below a threshold.
    pub fn below_length(self, threshold: Fixed) -> bool {
        self.length_squared() < threshold.saturating_mul(threshold)
    }
}

impl std::ops::Add for Vec2 {
    type Output = Self;
    fn add(self, other: Self) -> Self {
        Self {
            x: self.x + other.x,
            z: self.z + other.z,
        }
    }
}

impl std::ops::Sub for Vec2 {
    type Output = Self;
    fn sub(self, other: Self) -> Self {
        Self {
            x: self.x - other.x,
            z: self.z - other.z,
        }
    }
}

impl std::ops::Neg for Vec2 {
    type Output = Self;
    fn neg(self) -> Self {
        Self {
            x: -self.x,
            z: -self.z,
        }
    }
}

impl std::ops::AddAssign for Vec2 {
    fn add_assign(&mut self, other: Self) {
        self.x += other.x;
        self.z += other.z;
    }
}

impl std::ops::SubAssign for Vec2 {
    fn sub_assign(&mut self, other: Self) {
        self.x -= other.x;
        self.z -= other.z;
    }
}

#[cfg(test)]
mod tests {
    use super::{Fixed, MICROMETRE_SCALE, Vec2};

    #[test]
    fn fraction_scaling_is_exact() {
        assert_eq!(Fixed::from_mm(1).to_mm_floor(), 1);
        assert_eq!(Fixed::from_micro(1).to_micro_floor(), 1);
        assert_eq!(Fixed::one().raw(), MICROMETRE_SCALE);
    }

    #[test]
    fn multiplication_keeps_scale() {
        let value = Fixed::from_mm(3);
        assert_eq!(value.saturating_mul(Fixed::one()), Fixed::from_mm(3));
        // 0.5 exactly = raw 512. 3 mm * 0.5 = 1.5 mm = 1500 micrometres.
        let half = Fixed::from_raw(512);
        assert_eq!(half.to_micro_floor(), 0);
        assert_eq!(
            Fixed::from_mm(3).saturating_mul(half).to_micro_floor(),
            1500
        );
        // (7 mm / 2 mm) = 3.5 as a dimensionless ratio; raw = 3.5 * 1024.
        assert_eq!(
            Fixed::from_mm(7).saturating_div(Fixed::from_mm(2)).raw(),
            3_584
        );
        // (3000 mm / 5) = 600 exactly.
        assert_eq!(
            Fixed::from_mm(3000).saturating_div(Fixed::from_mm(5)).raw(),
            600 * 1024
        );
    }

    #[test]
    fn sqrt_returns_floor_with_exact_squares() {
        let square = Fixed::from_mm(9).saturating_mul(Fixed::from_mm(9));
        assert_eq!(square.sqrt(), Fixed::from_mm(9));

        let value = Fixed::from_mm(81);
        let root = value.sqrt();
        assert!(root.saturating_mul(root) <= value);
        let next = root + Fixed::one();
        assert!(next.saturating_mul(next) > value);
        // 81 mm as a length is 81,000 micrometres; sqrt is floor(284.6) = 284.
        assert_eq!(root.to_micro_floor(), 284);
    }

    #[test]
    fn vector_length_and_dot_are_consistent() {
        let a = Vec2::from_micro(300_000, 400_000);
        assert_eq!(a.length(), Fixed::from_mm(500));
        assert_eq!(a.length_squared().to_micro_floor(), 250_000_000_000);
        let b = Vec2::from_micro(100_000, 0);
        assert_eq!(a.dot(b).to_micro_floor(), 30_000_000_000);
        assert!(!a.perpendicular().x.is_zero());
        assert_eq!(a.perpendicular(), Vec2::from_micro(-400_000, 300_000));
        // A unit vector has length within one raw unit of one.
        let unit = a.saturating_div_length(a.length());
        let unit_length = unit.length().raw();
        assert!((1022..=1024).contains(&unit_length), "got {unit_length}");
    }
}
