import elasticsearch from '@elastic/elasticsearch';

export default new elasticsearch.Client({
  node: process.env.ELASTICSEARCH_URL,
});

// Processes {_id, _version, found, _source: {...}} to
// {id, ..._source}.
//
export function processMeta({
  _id: id,
  _source: source,

  found, // for mget queries
  _score, // for search queries

  highlight, // search result highlighting. Should be {<fieldName>: ['...']}

  inner_hits, // nested query search result highlighting.

  sort, // cursor when sorted
}) {
  if (found || _score !== undefined) {
    return {
      id,
      ...source,
      _cursor: sort,
      _score,
      highlight,
      inner_hits,
    };
  }
  return null; // not found
}
