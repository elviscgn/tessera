//! Integer footprints and deterministic cell occupancy.

use crate::{EntityId, GridPosition, QuarterTurn};
use std::collections::{BTreeMap, BTreeSet};

/// Maximum number of cells accepted in one footprint definition.
pub const MAX_FOOTPRINT_CELLS: usize = 1_048_576;

/// A footprint offset relative to an entity's anchor cell.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct FootprintOffset {
    /// East/west offset from the anchor.
    pub dx: i32,
    /// North/south offset from the anchor.
    pub dz: i32,
}

impl FootprintOffset {
    /// Creates an integer footprint offset.
    pub const fn new(dx: i32, dz: i32) -> Self {
        Self { dx, dz }
    }
}

/// Errors returned while validating a footprint definition or expansion.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FootprintError {
    /// A footprint must contain at least one cell.
    Empty,
    /// A footprint cannot contain the same offset more than once.
    DuplicateCell,
    /// Rectangle dimensions must be positive.
    ZeroDimension,
    /// A footprint exceeds the configured cell-count limit.
    TooLarge,
    /// Applying an offset would overflow a signed grid coordinate.
    CoordinateOverflow,
}

/// A normalized, sorted set of integer footprint offsets.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Footprint {
    offsets: Vec<FootprintOffset>,
}

impl Footprint {
    /// Creates and normalizes an arbitrary non-empty footprint.
    pub fn new<I>(offsets: I) -> Result<Self, FootprintError>
    where
        I: IntoIterator<Item = FootprintOffset>,
    {
        let mut offsets: Vec<_> = offsets.into_iter().collect();
        if offsets.is_empty() {
            return Err(FootprintError::Empty);
        }
        if offsets.len() > MAX_FOOTPRINT_CELLS {
            return Err(FootprintError::TooLarge);
        }
        offsets.sort_unstable();
        if offsets.windows(2).any(|pair| pair[0] == pair[1]) {
            return Err(FootprintError::DuplicateCell);
        }
        Ok(Self { offsets })
    }

    /// Creates the default one-cell footprint.
    pub fn single_cell() -> Self {
        Self {
            offsets: vec![FootprintOffset::new(0, 0)],
        }
    }

    /// Creates a rectangle anchored at its north-west cell.
    pub fn rectangle(width: u32, depth: u32) -> Result<Self, FootprintError> {
        if width == 0 || depth == 0 {
            return Err(FootprintError::ZeroDimension);
        }
        let count = usize::try_from(width)
            .ok()
            .and_then(|width| {
                usize::try_from(depth)
                    .ok()
                    .and_then(|depth| width.checked_mul(depth))
            })
            .ok_or(FootprintError::TooLarge)?;
        if count > MAX_FOOTPRINT_CELLS {
            return Err(FootprintError::TooLarge);
        }
        let mut offsets = Vec::with_capacity(count);
        for dz in 0..depth {
            for dx in 0..width {
                offsets.push(FootprintOffset::new(
                    i32::try_from(dx).map_err(|_| FootprintError::CoordinateOverflow)?,
                    i32::try_from(dz).map_err(|_| FootprintError::CoordinateOverflow)?,
                ));
            }
        }
        Self::new(offsets)
    }

    /// Returns normalized offsets in deterministic order.
    pub fn offsets(&self) -> &[FootprintOffset] {
        &self.offsets
    }

    /// Returns the number of occupied cells.
    pub fn len(&self) -> usize {
        self.offsets.len()
    }

    /// Returns whether this footprint has no cells.
    pub fn is_empty(&self) -> bool {
        self.offsets.is_empty()
    }

    /// Expands the footprint at an anchor using the canonical rotation table.
    pub fn occupied_cells(
        &self,
        anchor: GridPosition,
        rotation: QuarterTurn,
    ) -> Result<Vec<GridPosition>, FootprintError> {
        let mut cells = Vec::with_capacity(self.offsets.len());
        for offset in &self.offsets {
            let (dx, dz) = rotation.rotate_offset(offset.dx, offset.dz);
            let x = anchor
                .x
                .checked_add(dx)
                .ok_or(FootprintError::CoordinateOverflow)?;
            let z = anchor
                .z
                .checked_add(dz)
                .ok_or(FootprintError::CoordinateOverflow)?;
            cells.push(GridPosition::new(x, z, anchor.elevation_mm));
        }
        cells.sort_unstable();
        Ok(cells)
    }

    pub(crate) fn encode_canonical(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&(self.offsets.len() as u64).to_le_bytes());
        for offset in &self.offsets {
            out.extend_from_slice(&offset.dx.to_le_bytes());
            out.extend_from_slice(&offset.dz.to_le_bytes());
        }
    }
}

/// Errors returned while changing or checking occupancy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OccupancyError {
    /// The supplied cell list is empty.
    Empty,
    /// A candidate list contains a duplicate cell.
    DuplicateCell { cell: GridPosition },
    /// A candidate cell belongs to another live entity.
    CellOccupied {
        cell: GridPosition,
        occupant: EntityId,
    },
    /// A release or replacement attempted to mutate another entity's cell.
    NotOwned {
        cell: GridPosition,
        expected: EntityId,
        actual: Option<EntityId>,
    },
}

/// Deterministic cell-to-entity occupancy index.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct OccupancyGrid {
    owners: BTreeMap<GridPosition, EntityId>,
}

impl OccupancyGrid {
    /// Creates an empty occupancy index.
    pub const fn new() -> Self {
        Self {
            owners: BTreeMap::new(),
        }
    }

    /// Returns the number of occupied cells.
    pub fn len(&self) -> usize {
        self.owners.len()
    }

    /// Returns whether no cells are occupied.
    pub fn is_empty(&self) -> bool {
        self.owners.is_empty()
    }

    /// Returns the entity currently occupying a cell.
    pub fn owner(&self, cell: GridPosition) -> Option<EntityId> {
        self.owners.get(&cell).copied()
    }

    /// Iterates occupied cells in canonical `(x, z, elevation)` order.
    pub fn cells(&self) -> impl Iterator<Item = GridPosition> + '_ {
        self.owners.keys().copied()
    }

    /// Iterates `(cell, owner)` pairs in canonical order.
    pub fn entries(&self) -> impl Iterator<Item = (GridPosition, EntityId)> + '_ {
        self.owners.iter().map(|(&cell, &owner)| (cell, owner))
    }

    /// Returns all cells owned by an entity in canonical order.
    pub fn cells_for(&self, entity: EntityId) -> Vec<GridPosition> {
        self.owners
            .iter()
            .filter_map(|(&cell, &owner)| (owner == entity).then_some(cell))
            .collect()
    }

    /// Checks a candidate list without mutating the index.
    ///
    /// `allow_owner` is used for an atomic move/replace so an entity may keep
    /// cells it already owns while still being rejected by other owners.
    pub fn check_available(
        &self,
        cells: &[GridPosition],
        allow_owner: Option<EntityId>,
    ) -> Result<(), OccupancyError> {
        if cells.is_empty() {
            return Err(OccupancyError::Empty);
        }
        let mut seen = BTreeSet::new();
        for &cell in cells {
            if !seen.insert(cell) {
                return Err(OccupancyError::DuplicateCell { cell });
            }
            if let Some(occupant) = self.owner(cell)
                && Some(occupant) != allow_owner
            {
                return Err(OccupancyError::CellOccupied { cell, occupant });
            }
        }
        Ok(())
    }

    /// Atomically claims a list of previously free cells.
    pub fn occupy(
        &mut self,
        entity: EntityId,
        cells: &[GridPosition],
    ) -> Result<(), OccupancyError> {
        self.check_available(cells, None)?;
        for &cell in cells {
            self.owners.insert(cell, entity);
        }
        Ok(())
    }

    /// Releases cells only when every cell is owned by the requested entity.
    pub fn release(
        &mut self,
        entity: EntityId,
        cells: &[GridPosition],
    ) -> Result<(), OccupancyError> {
        self.check_owned(entity, cells)?;
        for cell in cells {
            self.owners.remove(cell);
        }
        Ok(())
    }

    /// Atomically replaces one entity's occupied cells.
    pub fn replace(
        &mut self,
        entity: EntityId,
        old_cells: &[GridPosition],
        new_cells: &[GridPosition],
    ) -> Result<(), OccupancyError> {
        self.check_owned(entity, old_cells)?;
        self.check_available(new_cells, Some(entity))?;
        for cell in old_cells {
            self.owners.remove(cell);
        }
        for &cell in new_cells {
            self.owners.insert(cell, entity);
        }
        Ok(())
    }

    pub(crate) fn encode_canonical(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&(self.owners.len() as u64).to_le_bytes());
        for (cell, owner) in &self.owners {
            out.extend_from_slice(&cell.x.to_le_bytes());
            out.extend_from_slice(&cell.z.to_le_bytes());
            out.extend_from_slice(&cell.elevation_mm.to_le_bytes());
            out.extend_from_slice(&owner.slot().to_le_bytes());
            out.extend_from_slice(&owner.generation().to_le_bytes());
        }
    }

    fn check_owned(&self, entity: EntityId, cells: &[GridPosition]) -> Result<(), OccupancyError> {
        if cells.is_empty() {
            return Err(OccupancyError::Empty);
        }
        let mut seen = BTreeSet::new();
        for &cell in cells {
            if !seen.insert(cell) {
                return Err(OccupancyError::DuplicateCell { cell });
            }
            let actual = self.owner(cell);
            if actual != Some(entity) {
                return Err(OccupancyError::NotOwned {
                    cell,
                    expected: entity,
                    actual,
                });
            }
        }
        Ok(())
    }
}

/// Errors returned when configuring footprints after initialization.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GridConfigurationError {
    /// Object type zero is reserved.
    InvalidObjectType,
    /// Public object type identifiers must be non-empty and bounded.
    InvalidObjectTypeId,
    /// An object type identifier was registered more than once.
    DuplicateObjectTypeId,
    /// Object type identifiers must be registered in canonical order.
    ObjectTypeOrderViolation,
    /// Definitions cannot change after commands or ticks have begun.
    WorldAlreadyStarted,
}

/// A failed consistency check between entities, footprints, and occupancy.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum GridInvariantError {
    /// The derived occupancy index does not match the stored index.
    OccupancyMismatch,
}

#[cfg(test)]
mod tests {
    use super::{Footprint, FootprintError, FootprintOffset, OccupancyError, OccupancyGrid};
    use crate::{EntityArena, GridPosition, QuarterTurn};

    fn entity() -> crate::EntityId {
        EntityArena::new()
            .spawn(1, GridPosition::new(0, 0, 0), QuarterTurn::R0)
            .unwrap()
            .id
    }

    #[test]
    fn footprints_normalize_and_rotate_deterministically() {
        let footprint =
            Footprint::new([FootprintOffset::new(1, 0), FootprintOffset::new(0, 0)]).unwrap();
        assert_eq!(
            footprint.offsets(),
            &[FootprintOffset::new(0, 0), FootprintOffset::new(1, 0)]
        );
        assert_eq!(
            footprint
                .occupied_cells(GridPosition::new(4, -2, 125), QuarterTurn::R1)
                .unwrap(),
            [GridPosition::new(4, -2, 125), GridPosition::new(4, -1, 125)]
        );
    }

    #[test]
    fn invalid_footprints_fail_before_occupancy_mutation() {
        assert_eq!(Footprint::new([]), Err(FootprintError::Empty));
        assert_eq!(
            Footprint::new([FootprintOffset::new(0, 0), FootprintOffset::new(0, 0)]),
            Err(FootprintError::DuplicateCell)
        );
        assert_eq!(
            Footprint::rectangle(0, 2),
            Err(FootprintError::ZeroDimension)
        );
    }

    #[test]
    fn occupancy_claims_replaces_and_releases_atomically() {
        let owner = entity();
        let other = EntityArena::new()
            .spawn(2, GridPosition::new(1, 0, 0), QuarterTurn::R0)
            .unwrap()
            .id;
        let first = [GridPosition::new(0, 0, 0), GridPosition::new(1, 0, 0)];
        let second = [GridPosition::new(1, 0, 0), GridPosition::new(2, 0, 0)];
        let mut occupancy = OccupancyGrid::new();
        occupancy.occupy(owner, &first).unwrap();
        assert_eq!(
            occupancy.occupy(other, &[GridPosition::new(1, 0, 0)]),
            Err(OccupancyError::CellOccupied {
                cell: GridPosition::new(1, 0, 0),
                occupant: owner,
            })
        );
        occupancy.replace(owner, &first, &second).unwrap();
        assert_eq!(occupancy.owner(GridPosition::new(0, 0, 0)), None);
        assert_eq!(occupancy.owner(GridPosition::new(2, 0, 0)), Some(owner));
        occupancy.release(owner, &second).unwrap();
        assert!(occupancy.is_empty());
    }
}
