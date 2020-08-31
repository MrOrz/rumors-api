import { GraphQLBoolean, GraphQLList, GraphQLString } from 'graphql';
import client from 'util/client';

import {
  createFilterType,
  createSortType,
  createConnectionType,
  getSortArgs,
  pagingArgs,
  timeRangeInput,
  moreLikeThisInput,
  getRangeFieldParamFromArithmeticExpression,
} from 'graphql/util';
import scrapUrls from 'util/scrapUrls';

import Reply from 'graphql/models/Reply';
import ReplyTypeEnum from 'graphql/models/ReplyTypeEnum';

export default {
  args: {
    filter: {
      type: createFilterType('ListReplyFilter', {
        userId: {
          type: GraphQLString,
        },
        appId: {
          type: GraphQLString,
        },
        moreLikeThis: {
          type: moreLikeThisInput,
        },
        selfOnly: {
          type: GraphQLBoolean,
          description: 'List the replies created by the requester themselves',
        },
        type: {
          type: ReplyTypeEnum,
          // FIXME: No deprecationReason for input object types yet
          // https://github.com/graphql/graphql-spec/pull/525
          description: '[Deprecated] use types instead.',
        },
        types: {
          type: new GraphQLList(ReplyTypeEnum),
          description: 'List the replies of certain types',
        },
        createdAt: {
          type: timeRangeInput,
          description:
            'List only the replies that were created between the specific time range.',
        },
      }),
    },
    orderBy: {
      type: createSortType('ListReplyOrderBy', ['_score', 'createdAt']),
    },
    ...pagingArgs,
  },
  async resolve(
    rootValue,
    { filter = {}, orderBy = [], ...otherParams },
    { userId, appId, loaders }
  ) {
    const body = {
      sort: getSortArgs(orderBy),
      track_scores: true, // for _score sorting
    };

    // Collecting queries that will be used in bool queries later
    const shouldQueries = []; // Affects scores
    const filterQueries = []; // Not affects scores

    if (filter.moreLikeThis) {
      const scrapResults = (await scrapUrls(filter.moreLikeThis.like, {
        client,
        cacheLoader: loaders.urlLoader,
      })).filter(r => r);

      const likeQuery = [
        filter.moreLikeThis.like,
        ...scrapResults.map(({ title, summary }) => `${title} ${summary}`),
      ];

      shouldQueries.push(
        {
          more_like_this: {
            fields: ['text', 'reference'],
            like: likeQuery,
            min_term_freq: 1,
            min_doc_freq: 1,
            minimum_should_match:
              filter.moreLikeThis.minimumShouldMatch || '10<70%',
          },
        },
        {
          nested: {
            path: 'hyperlinks',
            score_mode: 'sum',
            query: {
              more_like_this: {
                fields: ['hyperlinks.title', 'hyperlinks.summary'],
                like: likeQuery,
                min_term_freq: 1,
                min_doc_freq: 1,
                minimum_should_match:
                  filter.moreLikeThis.minimumShouldMatch || '10<70%',
              },
            },
          },
          inner_hits: {
            highlight: {
              order: 'score',
              fields: {
                'hyperlinks.title': {
                  number_of_fragments: 1, // Return only 1 piece highlight text
                  fragment_size: 200, // word count of highlighted fragment
                  type: 'plain',
                },
                'hyperlinks.summary': {
                  number_of_fragments: 1, // Return only 1 piece highlight text
                  fragment_size: 200, // word count of highlighted fragment
                  type: 'plain',
                },
              },
              require_field_match: false,
              pre_tags: ['<HIGHLIGHT>'],
              post_tags: ['</HIGHLIGHT>'],
            },
          },
        }
      );

      // Additionally, match the scrapped URLs with other reply's scrapped urls
      //
      const urls = scrapResults.reduce((urls, result) => {
        if (!result) return urls;

        if (result.url) urls.push(result.url);
        if (result.canonical) urls.push(result.canonical);
        return urls;
      }, []);

      if (urls.length > 0) {
        shouldQueries.push({
          nested: {
            path: 'hyperlinks',
            score_mode: 'sum',
            query: {
              terms: {
                'hyperlinks.url': urls,
              },
            },
          },
        });
      }
    }

    ['userId', 'appId', 'type' /* deprecated */].forEach(field => {
      if (!filter[field]) return;
      filterQueries.push({ term: { [field]: filter[field] } });
    });

    if (filter.types && filter.types.length > 0) {
      filterQueries.push({
        terms: {
          type: filter.types,
        },
      });
    }

    if (filter.selfOnly) {
      if (!userId) throw new Error('selfOnly can be set only after log in');
      filterQueries.push({ term: { userId } }, { term: { appId } });
    }

    if (filter.createdAt) {
      filterQueries.push({
        range: {
          createdAt: getRangeFieldParamFromArithmeticExpression(
            filter.createdAt
          ),
        },
      });
    }

    body.query = {
      bool: {
        should:
          shouldQueries.length === 0 ? [{ match_all: {} }] : shouldQueries,
        filter: filterQueries,
        minimum_should_match: 1, // At least 1 "should" query should present
      },
    };

    // should return search context for resolveEdges & resolvePageInfo
    return {
      index: 'replies',
      type: 'doc',
      body,
      ...otherParams,
    };
  },
  type: createConnectionType('ListReplyConnection', Reply),
};
