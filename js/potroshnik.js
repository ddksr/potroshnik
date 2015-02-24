(function ($) {
	var url = null,
		deletedIds = [],
		commands = {}, actions = {},
		queries = {
			articleList: function (x) {
				return {
					query: {
						filtered: {
							filter: {
								or: [
									{ prefix: { name: x } },
									{ prefix: { group: x } },
									{ prefix: { shop: x } }
								]
							}
						}
					}
				};
			},
			getBestArticle: function (x) {
				return {
					query: {
						filtered: {
							filter: {
								or: [
									{ term: { group: x } },
								]
							},
							query: {
								function_score: {
									script_score : {
										script: "- doc['price'].value * doc['quality'].value"
									}
								}
							}
						}
					}
				};
			}
		},
		storage = (function () {
			if(typeof(Storage) !== "undefined") {
				return { remove: function () {}, set: function () {}, get: function (name, def) { return def; }};
			}
			return {
				get: function (name, def) {
					var val = localStorage[name];
					return name !== undefined ? val : name;
				},
				set: function (name, val) {
					localStorage.setItem(name, val);
				},
				remove: function () {
					localStorage.removeItem(name);
				}
			};
		}()),
		req = function (type, path, query, cbs) {
			var async = true,
				result = null;
			if (cbs === null) {
				async = false;
				cbs = {
					success: function (resp) {
						result = resp;
					}
				};
			}
			else if (cbs === undefined) { cbs = {}; }
			$.ajax({
				url: url + path,
				data: query ? JSON.stringify(query) : undefined,
				contentType: 'application/json',
				dataType: 'json',
				async: async,
				type: type,
				success: cbs.success || function () {},
				err: cbs.error || function () {},
				statusCode: cbs.statusCode || {}
			});
			return result;
		},
		utils = {
			getFormData: function (form, mappers) {
				var data = {};
				if (mappers === undefined) { mappers = {}; }
				$(form).find('input,textarea,select').each(function () {
					var name = $(this).attr('name'),
						map = mappers[name] || function (x) { return x; };
					if (! name) { return; }
					data[name] = map($(this).val());
				});
				return data;
			},
			createTable: function (esResponse, header, url) {
				var table = $(document.createElement('table')),
					hRow = $('<thead><tr></tr></thead>');
				if (!esResponse) { return ''; }
				if (url) {
					hRow.append('<td>ID</td>');
				}
				$.each(header, function (i, obj) {
					hRow.append('<th>' + obj.name + '</th>');
				});
				table.append(hRow);
				$.each(esResponse, function (i, obj) {
					var row = $(document.createElement('tr'));
					if (url) {
						row.append('<td><a href="' + url + obj._id + '">' +
								   obj._id +
								   '</a></td>');
					}
					$.each(header, function (j, h) {
						var map = h.map || function (x) { return x; };
						row.append('<td>' + map(obj._source[h.key]) +  '</td>');
					});
					table.append(row);
				});
				return table.html();
			}
		},
		shoppingList = (function () {
			var list = [],
				addArticle = function (id, article) {
					var ulList = $('#shopping-list .shop-' + article.shop + ' ul'),
						li = $(document.createElement('li')).addClass('item');
					if(!ulList.length) {
						ulList = $(document.createElement('li'))
							.addClass('shop').addClass('shop-' + article.shop);
						ulList.append('<h3>' + article.shop + '</h3>');
						ulList.append('<ul></ul>');
						$('#shopping-list').append(ulList);
						ulList = ulList.children('ul');
					}
					li.html(article.name + ' (' + article.price.toFixed(2) + ' €)');
					ulList.append(li);
				};

			return {
				add: function (id, article) {
					list.push(article.group);
					addArticle(id, article);
				},
				clear: function () {
					list = [];
					$('#shopping-list').html('');
				},
				getList: function () {
					return list;
				},
				setList: function (newList) {
					list = newList;
				}
			};
		}()),
		showMessage = function (msg, type, container) {
			var p = $(document.createElement('p')).addClass('flakes-message');
			if (type) {	p.addClass(type); }
			p.html(msg);
			p.hide();
			$(container || '#messages').prepend(p);
			p.show('slow');
			setTimeout(function () {
				p.hide('slow', function () {
					p.remove();
				});
			}, 3000);
		},
		cache = (function () {
			var c = {},
				obtainers = {
					shop: function () {
						var elts = req('GET', '/potroshnik/shop/_search', null, null).hits.hits;
						return $.map(elts, function (elt) {
							return elt._source.name;
						});
					},
					group: function () {
						var elts = req('GET', '/potroshnik/group/_search', null, null).hits.hits;
						return $.map(elts, function (elt) {
							return elt._source.name;
						});
					}
				};
			return {
				get: function (prop) {
					if (c[prop] === undefined) {
						c[prop] = obtainers[prop]();
					}
					return c[prop];
				},
				clear: function (prop) {
					c[prop] = undefined;
				}
			};
		}()),
		refreshDOM = function () {
			$('#shops-list').html('');
			$('#groups-list').html('');
			$.each(cache.get('shop'), function (i, obj) {
				$('#shops-list').append('<option value="' + obj + '"></option>');
			});
			$.each(cache.get('group'), function (i, obj) {
				$('#groups-list').append('<option value="' + obj + '"></option>');
			});
		},
		selectPage = function (pageName, arg) {
			var fun;
			$('.page.current').removeClass('current');
			fun = $('#page-' + pageName).addClass('current').data('init');
			if (fun) {
				actions[fun].call(null, arg);
			}
		},
		checkRelated = function (data) {
			var updateCache = false;
			if ($.inArray(data.shop, cache.get('shop')) == -1) {
				req('POST', '/potroshnik/shop/', {
					name: data.shop
				}, null);
				updateCache = true;
			}
			if ($.inArray(data.group, cache.get('group')) == -1) {
				req('POST', '/potroshnik/group/', {
					name: data.group
				}, null);
				updateCache = true;
			}
			if (updateCache) {
				cache.clear();
				refreshDOM();
			}
		},
		execCommand = function () {
			var cmd = window.location.hash.substr(2),
				segments = cmd.split('/');
			if (!cmd) { return; }
			if (!commands[segments[0]]) {
				console.error('Command does not exist');
				return;
			}
			commands[segments[0]].apply(null, segments.splice(1));
		},
		install = function () {
			req('PUT', '/potroshnik');
		};

	url = storage.get('url');
	
	commands.page = selectPage;
	commands.connect = function () {
		url = $('#es-url').val();
		req('GET', '/', null, {
			success: function () {
				storage.set('url', url);
				req('GET', '/potroshnik', null, {
					statusCode: {
						404: function () {
							if (confirm('Potroshnik is not installed. Do you wish to install it?')) {
								install();
							}
						}
					}
				});
			},
			error: function () {
				alert('Could not connect to elasticsearch');
			}
		});
		window.location.href = "#/";
	};
	commands.list = function (command) {
		var html = $('#shopping-list')[0].outerHTML,
			list = shoppingList.getList(),
			name = 'Shopping list ' + new Date() + ' (' + list.splice(0, 3).join(', ') + ')',
			listActions = {
				save: function () {
					req('POST', '/potroshnik/list/', {
						list: list,
						html: html,
						name: name
					}, {
						success: function (resp) {
							$('#shopping-list').data('listId', resp._id);
							setTimeout(actions.clearShoppingList, 1000);
						}
					});
				},
				remove: function () {
					var id = $('#shopping-list').data('listId');
					if (id) {
						req('DELETE', '/potroshnik/list/' + id, null, {
							success: function () {
								actions.clearShoppingList();
								deletedIds.push(id);
							}
						});
					}
				}
			};
		listActions[command]();
	};
	actions.clearShoppingList = function () {
		shoppingList.clear();
		window.location.href = "#/";
		req('GET', '/potroshnik/list/_search', null, {
			success: function (resp) {
				$('#saved-lists').html('');
				$.each(resp.hits.hits, function (i, hit) {
					if ($.inArray(hit._id, deletedIds) !== -1) { return; }
					var li = $(document.createElement('li')).addClass('shopping-list');
					li.text(hit._source.name);
					li.on('click', function () {
						shoppingList.setList(hit._source.list);
						$('#shopping-list').data('listId', hit._id);
						$('#shopping-list').html(hit._source.html);
					});
					$('#saved-lists').append(li);
				});
			}
		});
	};
	actions.addToShoppingList = function () {
		var item = $(this).find('[name="item"]');
		req('POST', '/potroshnik/article/_search', queries.getBestArticle(item.val()), {
			success: function (resp) {
				var hits = resp.hits.hits;
				if (hits) {
					shoppingList.add(hits[0]._id, hits[0]._source);
				}
				item.val('');
			}
		});
	};
	actions.editArticle = function (id) {
		var form = this,
			data = null;
		if (id === undefined) {
			id = $(form).data('id');
			data = utils.getFormData(form, { 'quality': parseFloat, 'price': parseFloat });
			checkRelated(data);
			// save data
			req('PUT', '/potroshnik/article/' + id, data, {
				success: function (resp) {
					showMessage('Article saved', 'success');
				}
			});
		} else {
			form = $('#page-edit-article form');
			form.data('id', id);
			data = req('GET', '/potroshnik/article/' + id, null, null)._source;
			$.each(data, function (key, val) {
				form.find('[name="' + key + '"]').val(val);
			});
			form.find('legend').text('Edit article: ' + data.name);
		}
	};
	actions.showArticles = function () {
		var resp = {},
			queryString = this !== window ? $(this).val() : '',
			filter = queryString && queryString.length >= 3;
		if (queryString && !filter) { return; }
		resp = req('POST', '/potroshnik/article/_search',
				   filter ? queries.articleList(queryString) : null,
				   null);
		$('#article-list').html(utils.createTable(resp.hits.hits, [
			{ name: 'Group', key: 'group' },
			{ name: 'Name', key: 'name' },
			{ name: 'Shop', key: 'shop' },
			{ name: 'Price', key: 'price', map: function (x) { return x.toFixed(2) + ' €'; } },
			{ name: 'Quality', key: 'quality' }
		], '#/page/edit-article/'));
	};
	actions.newArticle = function () {
		var data = utils.getFormData(this, { 'quality': parseFloat, 'price': parseFloat });
		checkRelated(data);
		req('POST', '/potroshnik/article/', data, {
			success: function (resp) {
				showMessage('Article added', 'success');
				selectPage('edit-article', resp._id);
			}
		});
	};

	execCommand();
	$(window).on('hashchange', execCommand);
	$('#article-search').on('keyup', actions.showArticles);

	$( "form" ).on( "submit", function( event ) {
		event.preventDefault();
		actions[$(this).data('callback')].apply(this);
	});

	refreshDOM();

}(jQuery));

