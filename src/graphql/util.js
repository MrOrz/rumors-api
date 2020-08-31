import {
  GraphQLInputObjectType,
  GraphQLObjectType,
  GraphQLString,
  GraphQLInt,
  GraphQLList,
  GraphQLEnumType,
  GraphQLFloat,
} from 'graphql';

import Highlights from './models/Highlights';
import client from 'util/client';

// https://www.graph.cool/docs/tutorials/designing-powerful-apis-with-graphql-query-parameters-aing7uech3
//
// Filtering args definition & parsing
//

/**
 * @param {string} typeName
 * @param {GraphQLScalarType} argType
 * @param {string} description
 * @returns {GraphQLInputObjectType}
 */
function getArithmeticExpressionType(typeName, argType, description) {
  return new GraphQLInputObjectType({
    name: typeName,
    description,
    fields: {
      LT: { type: argType },
      LTE: { type: argType },
      GT: { type: argType },
      GTE: { type: argType },
      EQ: { type: argType },
    },
  });
}

export const timeRangeInput = getArithmeticExpressionType(
  'TimeRangeInput',
  GraphQLString,
  'List only the entries that were created between the specific time range. ' +
    'The time range value is in elasticsearch date format (https://www.elastic.co/guide/en/elasticsearch/reference/current/mapping-date-format.html)'
);
export const intRangeInput = getArithmeticExpressionType(
  'RangeInput',
  GraphQLInt,
  'List only the entries whose field match the criteria.'
);

/**
 * @param {object} arithmeticFilterObj - {LT, LTE, GT, GTE, EQ}, the structure returned by getArithmeticExpressionType
 * @returns {object} Elasticsearch range filter param
 * @see https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-range-query.html#range-query-field-params
 */
export function getRangeFieldParamFromArithmeticExpression(
  arithmeticFilterObj
) {
  // EQ overrides all other operators
  if (typeof arithmeticFilterObj.EQ !== 'undefined') {
    return {
      gte: arithmeticFilterObj.EQ,
      lte: arithmeticFilterObj.EQ,
    };
  }

  const conditionEntries = Object.entries(arithmeticFilterObj);

  if (conditionEntries.length === 0) throw new Error('Invalid Expression!');

  return Object.fromEntries(
    conditionEntries.map(([key, value]) => [key.toLowerCase(), value])
  );
}

export const moreLikeThisInput = new GraphQLInputObjectType({
  name: 'MoreLikeThisInput',
  description:
    'Parameters for Elasticsearch more_like_this query.\n' +
    'See: https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-mlt-query.html',
  fields: {
    like: {
      type: GraphQLString,
      description: 'The text string to search for.',
    },
    minimumShouldMatch: {
      type: GraphQLString,
      description:
        'more_like_this query\'s "minimum_should_match" query param.\n' +
        'See https://www.elastic.co/guide/en/elasticsearch/reference/current/query-dsl-minimum-should-match.html for possible values.',
    },
  },
});

export function createFilterType(typeName, args) {
  const filterType = new GraphQLInputObjectType({
    name: typeName,
    fields: () => ({
      ...args,
      // TODO: converting nested AND / OR to elasticsearch
      // AND: { type: new GraphQLList(filterType) },
      // OR: { type: new GraphQLList(filterType) },
    }),
  });
  return filterType;
}

//
// Sort args definition & parsing
//

const SortOrderEnum = new GraphQLEnumType({
  name: 'SortOrderEnum',
  values: {
    ASC: { value: 'asc' },
    DESC: { value: 'desc' },
  },
});

/**
 * @param {string} typeName
 * @param {Array<string|{name: string, description: string}>} filterableFields
 * @returns {GraphQLList<GarphQLInputObjectType>} sort input type for an field input argument.
 */
export function createSortType(typeName, filterableFields = []) {
  return new GraphQLList(
    new GraphQLInputObjectType({
      name: typeName,
      description:
        'An entry of orderBy argument. Specifies field name and the sort order. Only one field name is allowd per entry.',
      fields: filterableFields.reduce((fields, field) => {
        const fieldName = typeof field === 'string' ? field : field.name;
        const description =
          typeof field === 'string' ? undefined : field.description;

        return {
          ...fields,
          [fieldName]: { type: SortOrderEnum, description },
        };
      }, {}),
    })
  );
}

export const pagingArgs = {
  first: {
    type: GraphQLInt,
    description: 'Returns only first <first> results',
    defaultValue: 10,
  },
  after: {
    type: GraphQLString,
    description:
      'Specify a cursor, returns results after this cursor. cannot be used with "before".',
  },
  before: {
    type: GraphQLString,
    description:
      'Specify a cursor, returns results before this cursor. cannot be used with "after".',
  },
};

/**
 * @param {object[]} orderBy - sort input object type
 * @param {{[string]: (order: object) => object}} fieldFnMap - Defines one elasticsearch sort argument entry for a field
 * @returns {Array<{[string]: {order: string}}>} Elasticsearch sort argument in query body
 */
export function getSortArgs(orderBy, fieldFnMap = {}) {
  return orderBy
    .map(item => {
      const field = Object.keys(item)[0];
      const order = item[field];
      const defaultFieldFn = o => ({ [field]: { order: o } });

      return (fieldFnMap[field] || defaultFieldFn)(order);
    })
    .concat({ _id: { order: 'desc' } }); // enforce at least 1 sort order for pagination
}

// sort: [{fieldName: {order: 'desc'}}, {fieldName2: {order: 'desc'}}, ...]
// This utility function reverts the direction of each sort params.
//
function reverseSortArgs(sort) {
  if (!sort) return undefined;
  return sort.map(item => {
    const field = Object.keys(item)[0];
    const order = item[field].order === 'desc' ? 'asc' : 'desc';
    return {
      [field]: {
        ...item[field],
        order,
      },
    };
  });
}

// Export for custom resolveEdges() and resolveLastCursor()
//
export function getCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

export function getSearchAfterFromCursor(cursor) {
  if (!cursor) return undefined;
  return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
}

async function defaultResolveTotalCount({
  first, // eslint-disable-line no-unused-vars
  before, // eslint-disable-line no-unused-vars
  after, // eslint-disable-line no-unused-vars
  ...searchContext
}) {
  return (await client.count({
    ...searchContext,
    body: {
      ...searchContext.body,

      // totalCount cannot support these
      sort: undefined,
      track_scores: undefined,
    },
  })).body.count;
}

export async function defaultResolveEdges(
  { first, before, after, ...searchContext },
  args,
  { loaders }
) {
  if (before && after) {
    throw new Error('Use of before & after is prohibited.');
  }

  const nodes = await loaders.searchResultLoader.load({
    ...searchContext,
    body: {
      ...searchContext.body,
      size: first,
      search_after: getSearchAfterFromCursor(before || after),

      // if "before" is given, reverse the sort order and later reverse back
      //
      sort: before
        ? reverseSortArgs(searchContext.body.sort)
        : searchContext.body.sort,
      highlight: {
        order: 'score',
        fields: {
          text: {
            number_of_fragments: 1, // Return only 1 piece highlight text
            fragment_size: 200, // word count of highlighted fragment
            type: 'plain',
          },
        },
        pre_tags: ['<HIGHLIGHT>'],
        post_tags: ['</HIGHLIGHT>'],
      },
    },
  });

  if (before) {
    nodes.reverse();
  }

  return nodes.map(
    ({ _score: score, highlight, inner_hits, _cursor, ...node }) => ({
      node,
      cursor: getCursor(_cursor),
      score,
      highlight,
      inner_hits,
    })
  );
}

async function defaultResolveLastCursor(
  {
    first, // eslint-disable-line no-unused-vars
    before, // eslint-disable-line no-unused-vars
    after, // eslint-disable-line no-unused-vars
    ...searchContext
  },
  args,
  { loaders }
) {
  const lastNode = (await loaders.searchResultLoader.load({
    ...searchContext,
    body: {
      ...searchContext.body,
      sort: reverseSortArgs(searchContext.body.sort),
    },
    size: 1,
  }))[0];

  return lastNode && getCursor(lastNode._cursor);
}

async function defaultResolveFirstCursor(
  {
    first, // eslint-disable-line no-unused-vars
    before, // eslint-disable-line no-unused-vars
    after, // eslint-disable-line no-unused-vars
    ...searchContext
  },
  args,
  { loaders }
) {
  const firstNode = (await loaders.searchResultLoader.load({
    ...searchContext,
    size: 1,
  }))[0];

  return firstNode && getCursor(firstNode._cursor);
}

async function defaultResolveHighlights(edge) {
  const {
    highlight: { text },
    inner_hits,
  } = edge;

  const hyperlinks = inner_hits?.hyperlinks.hits.hits?.map(
    ({
      _source: { url },
      highlight: { 'hyperlinks.title': title, 'hyperlinks.summary': summary },
    }) => ({
      url,
      title: title ? title[0] : undefined,
      summary: summary ? summary[0] : undefined,
    })
  );

  // Elasticsearch highlight returns an array because it can be multiple fragments,
  // We directly returns first element(text, title, summary) here because we set number_of_fragments to 1.
  return { text: text ? text[0] : undefined, hyperlinks };
}

// All search
//
export function createConnectionType(
  typeName,
  nodeType,
  {
    // Default resolvers
    resolveTotalCount = defaultResolveTotalCount,
    resolveEdges = defaultResolveEdges,
    resolveLastCursor = defaultResolveLastCursor,
    resolveFirstCursor = defaultResolveFirstCursor,
    resolveHighlights = defaultResolveHighlights,
  } = {}
) {
  return new GraphQLObjectType({
    name: typeName,
    fields: () => ({
      totalCount: {
        type: GraphQLInt,
        description:
          'The total count of the entire collection, regardless of "before", "after".',
        resolve: resolveTotalCount,
      },
      edges: {
        type: new GraphQLList(
          new GraphQLObjectType({
            name: `${typeName}Edges`,
            fields: {
              node: { type: nodeType },
              cursor: { type: GraphQLString },
              score: { type: GraphQLFloat },
              highlight: {
                type: Highlights,
                resolve: resolveHighlights,
              },
            },
          })
        ),
        resolve: resolveEdges,
      },
      pageInfo: {
        type: new GraphQLObjectType({
          name: `${typeName}PageInfo`,
          fields: {
            lastCursor: {
              type: GraphQLString,
              description:
                'The cursor pointing to the last node of the entire collection, regardless of "before" and "after". Can be used to determine if is in the last page.',
              resolve: resolveLastCursor,
            },
            firstCursor: {
              type: GraphQLString,
              description:
                'The cursor pointing to the first node of the entire collection, regardless of "before" and "after". Can be used to determine if is in first page.',
              resolve: resolveFirstCursor,
            },
          },
        }),
        resolve: params => params,
      },
    }),
  });
}

export const AUTH_ERROR_MSG = 'userId is not set via query string.';

export function assertUser({ userId, appId }) {
  if (!userId) {
    throw new Error(AUTH_ERROR_MSG);
  }

  if (userId && !appId) {
    throw new Error(
      'userId is set, but x-app-id or x-app-secret is not set accordingly.'
    );
  }
}

export function filterArticleRepliesByStatus(articleReplies, status) {
  if (!status) return articleReplies;

  // If a replyConnection does not have status, it is considered "NORMAL".
  //
  return articleReplies.filter(articleReply => {
    if (status !== 'NORMAL') return articleReply.status === status;

    return (
      articleReply.status === undefined || articleReply.status === 'NORMAL'
    );
  });
}

export function filterArticleCategoriesByStatus(articleCategories, status) {
  if (!status) return articleCategories;

  // If a articleCategory does not have status, it is considered "NORMAL".
  //
  return articleCategories.filter(articleCategory => {
    if (status !== 'NORMAL') return articleCategory.status === status;

    return (
      articleCategory.status === undefined ||
      articleCategory.status === 'NORMAL'
    );
  });
}
