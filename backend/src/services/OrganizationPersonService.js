import { prisma } from '@jump/db';
import { ConflictError } from '../middleware/errorHandler.js';
import logger from '../utils/logger.js';

const SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  isAccountRepresentative: true,
};

export function serializeOrganizationPerson(person) {
  return {
    id: person.id,
    firstName: person.firstName,
    lastName: person.lastName,
    isAccountRepresentative: person.isAccountRepresentative,
  };
}

class OrganizationPersonService {
  async listPeople(organizationId) {
    const people = await prisma.organizationPerson.findMany({
      where: { organizationId },
      orderBy: [{ isAccountRepresentative: 'desc' }, { createdAt: 'asc' }],
      select: SUMMARY_SELECT,
    });

    return people.map(serializeOrganizationPerson);
  }

  async createPerson(actorId, organizationId, data) {
    const createArgs = {
      data: { organizationId, ...data },
      select: SUMMARY_SELECT,
    };

    let person;
    try {
      if (data.isAccountRepresentative) {
        person = await prisma.$transaction(async (tx) => {
          await tx.organizationPerson.updateMany({
            where: { organizationId, isAccountRepresentative: true },
            data: { isAccountRepresentative: false },
          });
          return tx.organizationPerson.create(createArgs);
        });
      } else {
        person = await prisma.organizationPerson.create(createArgs);
      }
    } catch (error) {
      if (data.isAccountRepresentative && error?.code === 'P2002') {
        throw new ConflictError('Account representative changed concurrently; please retry');
      }
      throw error;
    }

    logger.info('Organization person changed', {
      event: 'organization_person_changed',
      actorId,
      organizationId,
      personId: person.id,
      action: 'created',
    });

    return serializeOrganizationPerson(person);
  }

  async deletePerson(actorId, organizationId, personId) {
    const result = await prisma.organizationPerson.deleteMany({
      where: { id: personId, organizationId },
    });
    if (result.count === 0) return false;

    logger.info('Organization person changed', {
      event: 'organization_person_changed',
      actorId,
      organizationId,
      personId,
      action: 'deleted',
    });

    return true;
  }
}

export default new OrganizationPersonService();
