//! Generational entity storage with deterministic lowest-slot reuse.

use crate::{GridPosition, QuarterTurn};
use std::collections::BTreeSet;

/// A stable entity identity. Generation zero is reserved as invalid.
#[derive(Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
pub struct EntityId {
    slot: u32,
    generation: u32,
}

impl EntityId {
    /// Creates an ID when its generation is valid.
    pub const fn new(slot: u32, generation: u32) -> Option<Self> {
        if generation == 0 {
            None
        } else {
            Some(Self { slot, generation })
        }
    }

    /// Returns the slot component.
    pub const fn slot(self) -> u32 {
        self.slot
    }

    /// Returns the generation component.
    pub const fn generation(self) -> u32 {
        self.generation
    }
}

/// The authoritative state carried for one live entity in Milestone 1.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EntityState {
    /// Stable generational identity.
    pub id: EntityId,
    /// Consumer-defined authoritative object handle.
    pub object_type: u32,
    /// Integer transform.
    pub position: GridPosition,
    /// Canonical quarter-turn.
    pub rotation: QuarterTurn,
}

/// Errors that can occur while changing the entity arena.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EntityError {
    /// The ID does not refer to a live entity at its generation.
    UnknownEntity,
    /// A new slot cannot be represented by the protocol's `u32` slot field.
    SlotExhausted,
    /// A generation cannot be incremented without wrapping to invalid state.
    GenerationExhausted,
}

/// A deterministic generational arena backed by normalized component stores.
///
/// Slot generations and liveness are stored separately from object type and
/// transform components. Active iteration remains ascending by slot, while
/// every mutation checks both slot and generation before touching a component.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct EntityArena {
    generations: Vec<u32>,
    alive: Vec<bool>,
    object_types: Vec<u32>,
    positions: Vec<GridPosition>,
    rotations: Vec<QuarterTurn>,
    free_slots: BTreeSet<u32>,
}

impl EntityArena {
    /// Creates an empty arena.
    pub const fn new() -> Self {
        Self {
            generations: Vec::new(),
            alive: Vec::new(),
            object_types: Vec::new(),
            positions: Vec::new(),
            rotations: Vec::new(),
            free_slots: BTreeSet::new(),
        }
    }

    /// Creates an entity in the lowest available slot.
    pub fn spawn(
        &mut self,
        object_type: u32,
        position: GridPosition,
        rotation: QuarterTurn,
    ) -> Result<EntityState, EntityError> {
        let (slot, generation) = if let Some(&slot) = self.free_slots.iter().next() {
            self.free_slots.remove(&slot);
            let index = slot as usize;
            (slot, self.generations[index])
        } else {
            let slot =
                u32::try_from(self.generations.len()).map_err(|_| EntityError::SlotExhausted)?;
            self.generations.push(1);
            self.alive.push(false);
            self.object_types.push(0);
            self.positions.push(GridPosition::new(0, 0, 0));
            self.rotations.push(QuarterTurn::R0);
            (slot, 1)
        };

        let id = EntityId::new(slot, generation).ok_or(EntityError::GenerationExhausted)?;
        let index = slot as usize;
        self.alive[index] = true;
        self.object_types[index] = object_type;
        self.positions[index] = position;
        self.rotations[index] = rotation;
        Ok(EntityState {
            id,
            object_type,
            position,
            rotation,
        })
    }

    /// Changes an entity transform after a generation check.
    pub fn move_entity(
        &mut self,
        id: EntityId,
        position: GridPosition,
        rotation: QuarterTurn,
    ) -> Result<EntityState, EntityError> {
        let index = self.valid_slot_index(id)?;
        self.positions[index] = position;
        self.rotations[index] = rotation;
        Ok(self.state_at(index).expect("validated entity must be live"))
    }

    /// Removes an entity and advances its generation.
    pub fn despawn(&mut self, id: EntityId) -> Result<EntityState, EntityError> {
        let index = self.valid_slot_index(id)?;
        let next_generation = self.generations[index]
            .checked_add(1)
            .ok_or(EntityError::GenerationExhausted)?;
        let entity = self.state_at(index).expect("validated entity must be live");
        self.alive[index] = false;
        self.generations[index] = next_generation;
        self.free_slots.insert(id.slot());
        Ok(entity)
    }

    /// Looks up a live entity only when its generation matches.
    pub fn get(&self, id: EntityId) -> Option<EntityState> {
        let index = self.valid_slot_index(id).ok()?;
        self.state_at(index)
    }

    /// Returns active entities in ascending slot order.
    pub fn iter(&self) -> impl Iterator<Item = EntityState> + '_ {
        self.alive
            .iter()
            .enumerate()
            .filter(|(_, alive)| **alive)
            .filter_map(|(index, _)| self.state_at(index))
    }

    /// Returns the number of live entities.
    pub fn len(&self) -> usize {
        self.alive.iter().filter(|alive| **alive).count()
    }

    /// Returns whether the arena has no live entities.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub(crate) fn encode_canonical(&self, out: &mut Vec<u8>) {
        out.extend_from_slice(&(self.generations.len() as u64).to_le_bytes());
        for index in 0..self.generations.len() {
            out.extend_from_slice(&self.generations[index].to_le_bytes());
            if self.alive[index] {
                out.push(1);
                out.extend_from_slice(&self.object_types[index].to_le_bytes());
                out.extend_from_slice(&self.positions[index].x.to_le_bytes());
                out.extend_from_slice(&self.positions[index].z.to_le_bytes());
                out.extend_from_slice(&self.positions[index].elevation_mm.to_le_bytes());
                out.push(self.rotations[index].as_u8());
            } else {
                out.push(0);
            }
        }
    }

    fn valid_slot_index(&self, id: EntityId) -> Result<usize, EntityError> {
        let index = usize::try_from(id.slot()).map_err(|_| EntityError::UnknownEntity)?;
        let valid = self
            .generations
            .get(index)
            .zip(self.alive.get(index))
            .is_some_and(|(&generation, &alive)| generation == id.generation() && alive);
        valid.then_some(index).ok_or(EntityError::UnknownEntity)
    }

    fn state_at(&self, index: usize) -> Option<EntityState> {
        if !self.alive.get(index).copied().unwrap_or(false) {
            return None;
        }
        Some(EntityState {
            id: EntityId::new(index as u32, self.generations[index])
                .expect("live slot generations are never zero"),
            object_type: self.object_types[index],
            position: self.positions[index],
            rotation: self.rotations[index],
        })
    }
}
