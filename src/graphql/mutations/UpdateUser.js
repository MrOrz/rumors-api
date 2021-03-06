import { GraphQLString } from 'graphql';
import client from 'util/client';
import User from 'graphql/models/User';
import { omit, omitBy } from 'lodash';
import { AvatarTypes } from 'util/user';
import AvatarTypeEnum from 'graphql/models/AvatarTypeEnum';

export default {
  type: User,
  description: 'Change attribute of a user',
  args: {
    name: { type: GraphQLString },
    slug: { type: GraphQLString },
    avatarType: { type: AvatarTypeEnum },
    avatarData: { type: GraphQLString },
    bio: { type: GraphQLString },
  },
  async resolve(
    rootValue,
    { name, slug, avatarType, avatarData, bio },
    { userId }
  ) {
    let doc = omitBy(
      {
        updatedAt: new Date().toISOString(),
        name,
        slug,
        avatarType,
        avatarData,
        bio,
      },
      v => v === undefined || v === null || v === ''
    );

    if (Object.keys(doc).length === 1)
      throw new Error(`There's nothing to update`);

    // Ensure uniqueness of slug
    if (slug !== undefined) {
      const {
        body: { count },
      } = await client.count({
        index: 'users',
        type: 'doc',
        body: {
          query: {
            bool: {
              must: [{ term: { slug } }],
              must_not: [{ ids: { values: [userId] } }],
            },
          },
        },
      });
      if (count > 0) throw new Error(`Slug already taken`);
    }

    if (avatarType && avatarType !== AvatarTypes.OpenPeeps)
      doc = omit(doc, ['avatarData']);

    const {
      body: {
        result,
        get: { _source },
      },
    } = await client.update({
      index: 'users',
      type: 'doc',
      id: userId,
      body: {
        doc,
        _source: true,
      },
    });

    if (result === 'noop') {
      throw new Error(`Cannot update user`);
    }

    return { id: userId, ..._source };
  },
};
