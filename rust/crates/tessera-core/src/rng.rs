//! Versioned deterministic ChaCha8 state.

use rand_chacha::{
    ChaCha8Rng,
    rand_core::{Rng, SeedableRng},
};

/// Version of Tessera's ChaCha8 seed/draw contract.
pub const RNG_ALGORITHM_VERSION: u16 = 1;

pub type Seed = [u8; 32];

#[derive(Clone)]
pub(crate) struct DeterministicRng {
    seed: Seed,
    rng: ChaCha8Rng,
    draws: u64,
}

impl DeterministicRng {
    pub(crate) fn new(seed: Seed) -> Self {
        Self {
            seed,
            rng: ChaCha8Rng::from_seed(seed),
            draws: 0,
        }
    }

    pub(crate) fn next_u64(&mut self) -> u64 {
        let value = self.rng.next_u64();
        self.draws = self.draws.saturating_add(1);
        value
    }

    pub(crate) const fn seed(&self) -> Seed {
        self.seed
    }

    pub(crate) const fn draws(&self) -> u64 {
        self.draws
    }
}

#[cfg(test)]
mod tests {
    use super::{ChaCha8Rng, DeterministicRng, SeedableRng};
    use rand_chacha::rand_core::Rng;

    #[test]
    fn zero_seed_reference_vector_is_stable() {
        let mut rng = ChaCha8Rng::from_seed([0; 32]);
        let values = [
            rng.next_u64(),
            rng.next_u64(),
            rng.next_u64(),
            rng.next_u64(),
        ];
        assert_eq!(
            values,
            [
                0xd6405f892fef003e,
                0xa1a5091fe8b85b7f,
                0x3b7f9acec30e842c,
                0x1e1a71ef88e11b18,
            ]
        );

        let mut wrapped = DeterministicRng::new([0; 32]);
        assert_eq!(wrapped.next_u64(), values[0]);
        assert_eq!(wrapped.draws(), 1);
    }
}
